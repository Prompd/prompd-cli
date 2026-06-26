/**
 * Package installation — the single, host-agnostic installer for every Prompd
 * artifact type (packages, skills, workflows, node-templates). Ported to match
 * @prompd/cli's RegistryClient.extractAndInstallPackage / uninstall so the browser,
 * desktop app, and CLI install identically.
 *
 * The download fetch, the writable file sink, and the (host-only) tool deployment are
 * INJECTED, so the same logic runs in the browser (a workspace FileService) and in
 * the CLI/sidecar (Node fs) with no Node imports here. Core stays Node-free — it never
 * computes '~'; the caller passes the install `root` (the open workspace for a local
 * install, the home dir for a global one). Layout matches the CLI:
 *
 *     <root>/.prompd/<typeDir>/<@scope/name>/<version>/...   (packages/skills/workflows)
 *     <root>/.prompd/templates/<slug>-<version>.pdpkg        (node-templates: raw archive)
 */
import { extractPdpkg } from './file-system';
import { parsePackageReference, type PackageDownloader } from './package-ref';
import { joinPosix, normalizePosix } from './path-utils';
import { getInstallDirForType, isValidPackageType, type PackageType } from '../../types';

/** Max .pdpkg size accepted for install (matches the CLI). */
const MAX_PACKAGE_SIZE = 50 * 1024 * 1024;

/** Deploy an installed skill into a tool-native dir (e.g. ~/.claude/skills). Host-only
 *  (Node fs); the browser omits it. Injected so core stays Node-free. */
export type ToolDeployHook = (opts: { installedPath: string; name: string; tool: string }) => void | Promise<void>;

/**
 * A writable sink the host injects so installPackage stays FS-/Node-agnostic.
 * Browser: an adapter over the workspace FileService; CLI/sidecar: over Node fs.
 */
export interface PackageStore {
  /** Write a UTF-8 file, creating parent directories as needed. */
  writeFile(path: string, content: string): void | Promise<void>;
  /** Write raw bytes — required for node-templates (stored as the raw .pdpkg). */
  writeBytes?(path: string, bytes: Uint8Array): void | Promise<void>;
  /** Remove a directory and its contents if present. */
  removeDir?(path: string): void | Promise<void>;
  /** Remove a single file if present (node-template .pdpkg uninstall). */
  removeFile?(path: string): void | Promise<void>;
  /** Read a UTF-8 file, or null if absent — used to merge the workspace prompd.json. */
  readFile?(path: string): Promise<string | null> | string | null;
  /** Read raw bytes — used to match a node-template .pdpkg by its manifest on uninstall. */
  readBytes?(path: string): Promise<Uint8Array> | Uint8Array;
  /** List a directory's entry names — used to find a node-template .pdpkg to uninstall. */
  readdir?(path: string): Promise<string[]> | string[];
}

export interface InstallPackageOptions {
  /** "@scope/name@version" or "@scope/name" (defaults to latest). */
  ref: string;
  /** Type HINT. The package's own manifest `type` wins; this is the fallback. */
  type?: PackageType;
  /** Install root: the open workspace (local) or the home dir (global). */
  root: string;
  /** Writable sink for the chosen host. */
  store: PackageStore;
  /** Fetch the .pdpkg bytes for a (name, version). May resolve 'latest'. */
  download: PackageDownloader;
  /** Global install — skips the workspace prompd.json dependency record (CLI parity). */
  global?: boolean;
  /** Deploy the installed skill to these tools (skills only), via deployTool. */
  tools?: string[];
  /** Host hook performing the per-tool deploy. Required when `tools` is set. */
  deployTool?: ToolDeployHook;
}

export interface InstalledPackage {
  /** Full scoped name (manifest-authoritative when present), e.g. "@prompd/core". */
  name: string;
  /** Resolved version (from the package manifest when present). */
  version: string;
  scope?: string;
  /** Resolved type (from the package manifest when present). */
  type: PackageType;
  /** Where it was written: the version dir, or the .pdpkg path for node-templates. */
  installedPath: string;
  /** Entry-relative paths written (empty for node-templates). */
  files: string[];
}

/** Slugify a package name for a filename: @scope/name -> scope-name (CLI parity). */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[@/]+/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** A package's directory (parent of its per-version installs):
 *  <root>/.prompd/<typeDir>/<@scope/name>/. */
function resolvePackageDir(root: string, type: PackageType, name: string): string {
  return joinPosix(root, '.prompd', getInstallDirForType(type), name);
}

/** A specific version's install dir: <packageDir>/<version>/. */
function resolveInstallDir(root: string, type: PackageType, name: string, version: string): string {
  return joinPosix(resolvePackageDir(root, type, name), version);
}

/* ---- workspace prompd.json dependency tracking (ported from @prompd/cli's
 * registry.addWorkspaceDependency / removeWorkspaceDependency). NON-FATAL. ---- */

async function addWorkspaceDependency(store: PackageStore, root: string, name: string, version: string): Promise<void> {
  if (!store.readFile) return;
  const manifestPath = joinPosix(root, 'prompd.json');
  try {
    const existing = await store.readFile(manifestPath);
    const manifest: Record<string, unknown> = existing && existing.trim() ? JSON.parse(existing) : {};
    if (!manifest.dependencies || typeof manifest.dependencies !== 'object') manifest.dependencies = {};
    (manifest.dependencies as Record<string, string>)[name] = version;
    await store.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  } catch { /* non-fatal: dependency tracking shouldn't block install */ }
}

async function removeWorkspaceDependency(store: PackageStore, root: string, name: string): Promise<void> {
  if (!store.readFile) return;
  const manifestPath = joinPosix(root, 'prompd.json');
  try {
    const existing = await store.readFile(manifestPath);
    if (!existing || !existing.trim()) return;
    const manifest = JSON.parse(existing) as Record<string, unknown>;
    const deps = manifest.dependencies;
    if (!deps || typeof deps !== 'object') return;
    delete (deps as Record<string, string>)[name];
    await store.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  } catch { /* non-fatal */ }
}

/** Parse the package manifest (manifest.json | prompd.json) from the extracted map. */
function readManifest(files: Map<string, string>): { name?: string; version?: string; type?: string; dependencies?: Record<string, string> } {
  const raw = files.get('manifest.json') ?? files.get('prompd.json');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

/**
 * Install a registry artifact, matching the CLI. Resolves the type from the package's
 * own manifest (the `type` option is only a fallback). Standard types extract to
 * <root>/.prompd/<typeDir>/<name>/<version>/ with a `.prmdmeta`; node-templates are
 * stored as the raw .pdpkg. Installs the package's own dependencies recursively,
 * records the dependency in the workspace prompd.json (local installs only), and
 * deploys to any requested tools. Idempotent per version.
 */
export async function installPackage(opts: InstallPackageOptions): Promise<InstalledPackage> {
  return installInternal(opts, new Set<string>());
}

async function installInternal(opts: InstallPackageOptions, visited: Set<string>): Promise<InstalledPackage> {
  const { ref, root, store, download, global, tools, deployTool } = opts;
  const parsed = parsePackageReference(ref);

  const bytes = await download(parsed.name, parsed.version);
  if (bytes.length > MAX_PACKAGE_SIZE) {
    throw new Error(`Package too large: ${bytes.length} bytes (max ${MAX_PACKAGE_SIZE})`);
  }
  const files = await extractPdpkg(bytes);
  if (files.size === 0) {
    throw new Error(`Package "${parsed.name}" contains no installable files.`);
  }

  // Manifest is authoritative for name/version/type (download may have resolved 'latest').
  const m = readManifest(files);
  const name = (typeof m.name === 'string' && m.name) ? m.name : parsed.name;
  const version = (typeof m.version === 'string' && m.version) ? m.version : parsed.version;
  const type: PackageType = (typeof m.type === 'string' && isValidPackageType(m.type))
    ? m.type
    : (opts.type && isValidPackageType(opts.type) ? opts.type : 'package');

  // Install the package's own dependencies first (recursive; self-/cycle-guarded).
  visited.add(name);
  if (m.dependencies && typeof m.dependencies === 'object') {
    for (const [depName, depVersion] of Object.entries(m.dependencies)) {
      if (depName === name || visited.has(depName)) continue;
      await installInternal({ ...opts, ref: `${depName}@${depVersion}`, type: undefined }, visited);
    }
  }

  let installedPath: string;
  const written: string[] = [];

  if (type === 'node-template') {
    // Node-templates are stored as the raw .pdpkg (not extracted) so template handlers
    // can scan the templates dir uniformly.
    if (!store.writeBytes) {
      throw new Error('Installing a node-template requires a PackageStore with writeBytes (binary). This host does not support it.');
    }
    const dir = joinPosix(root, '.prompd', getInstallDirForType('node-template'));
    installedPath = joinPosix(dir, `${slugify(name)}-${version}.pdpkg`);
    await store.writeBytes(installedPath, bytes);
  } else {
    installedPath = resolveInstallDir(root, type, name, version);
    const base = normalizePosix(installedPath);
    await store.removeDir?.(installedPath); // clean reinstall of this version
    for (const [rel, content] of files) {
      const dest = joinPosix(installedPath, rel); // joinPosix resolves '..', so an escape leaves `base`
      if (dest !== base && !dest.startsWith(base + '/')) {
        throw new Error(`Security violation: extracted path escapes install directory: ${rel}`);
      }
      await store.writeFile(dest, content);
      written.push(rel);
    }
    // Per-install metadata for cache tracking (CLI writes packageData.metadata).
    await store.writeFile(joinPosix(installedPath, '.prmdmeta'), JSON.stringify(m, null, 2) + '\n');

    // Deploy the skill to any requested tools (skills only), via the host hook.
    if (tools && tools.length > 0) {
      if (type !== 'skill') throw new Error(`Tool deploy is only valid for skills, but '${name}' is a ${type}.`);
      if (!deployTool) throw new Error('tools were requested but no deployTool hook was provided.');
      for (const tool of tools) await deployTool({ installedPath, name, tool });
    }
  }

  // Record in the workspace prompd.json — local installs only (CLI parity).
  if (!global) await addWorkspaceDependency(store, root, name, version);

  return { name, version, scope: parsed.scope, type, installedPath, files: written };
}

export interface UninstallPackageOptions {
  /** "@scope/name" (a version suffix is accepted but ignored). */
  ref: string;
  /** Install root the caller chose. */
  root: string;
  /** Writable sink for the chosen host. */
  store: PackageStore;
  /** Global uninstall — skips the workspace prompd.json dependency removal. */
  global?: boolean;
}

export interface UninstalledPackage {
  name: string;
  scope?: string;
  /** Dirs/files removed. */
  removed: string[];
}

/**
 * Uninstall by name, matching the CLI: scan EVERY type dir under <root>/.prompd/ and
 * remove the package's dir (all versions); for node-templates, find the .pdpkg whose
 * manifest name matches and remove it. Drops the prompd.json dependency. Idempotent.
 */
export async function uninstallPackage(opts: UninstallPackageOptions): Promise<UninstalledPackage> {
  const { root, store, global } = opts;
  if (!store.removeDir) throw new Error('Uninstall requires a PackageStore with removeDir.');
  const parsed = parsePackageReference(opts.ref);
  const name = parsed.name;
  const removed: string[] = [];

  for (const type of ['package', 'workflow', 'skill', 'node-template'] as PackageType[]) {
    if (type === 'node-template') {
      // Stored as <slug>-<version>.pdpkg at the templates root. Match by reading each
      // archive's manifest name EXACTLY (CLI parity) — a slug prefix would collide,
      // e.g. '@scope/foo' (prefix 'scope-foo-') would also match '@scope/foo-bar'.
      const dir = joinPosix(root, '.prompd', getInstallDirForType('node-template'));
      if (!store.readdir || !store.removeFile || !store.readBytes) continue;
      try {
        for (const entry of await store.readdir(dir)) {
          if (!entry.endsWith('.pdpkg')) continue;
          const p = joinPosix(dir, entry);
          try {
            const m = readManifest(await extractPdpkg(await store.readBytes(p)));
            if (m.name === name) { await store.removeFile(p); removed.push(p); }
          } catch { /* unreadable archive — skip */ }
        }
      } catch { /* templates dir absent */ }
    } else {
      const dir = resolvePackageDir(root, type, name);
      await store.removeDir(dir);
      removed.push(dir);
    }
  }

  if (!global) await removeWorkspaceDependency(store, root, name);
  return { name, scope: parsed.scope, removed };
}
