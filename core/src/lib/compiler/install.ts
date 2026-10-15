// src/lib/compiler/install.ts
/**
 * Package installation: the single, host-agnostic installer for every Prompd
 * artifact type (packages, workflows, skills, agents). Every package is opened
 * with openPdpkg, and the WHOLE dependency tree is resolved and verified before
 * the store is touched, so nothing unverified (and nothing from a tree that fails
 * verification) is written.
 *
 * The download fetch, the writable store and the (host-only) tool deployment
 * are INJECTED, so the same logic runs in the browser, the CLI and the sidecar
 * with no Node imports here. Layout:
 *
 *     <root>/<installDir>/<typeDir>/<@scope/name>/<version>/...
 *
 * `installDir` is one dot-directory ('.prompd', '.corenel'), or '' when `root`
 * is already the state directory. Each version directory holds the package's
 * files, prompd.json, `.package.pdpkg` (the exact archive, so the install can be
 * re-verified; written when the store has writeBytes) and `.prmdmeta`.
 */
import semver from 'semver';
import type { PackageDownloader } from './package-ref';
import { joinPosix, normalizePosix } from './path-utils';
import { getInstallDirForType, type PackageType } from '../../types';
import { openPdpkg } from '../package/verify';
import { PackageVerificationError } from '../package/errors';
import type { VerifiedPackage } from '../package/verify';
import { PACKAGE_NAME_RE, unscopedName, type PackageRequires } from '../package/manifest';
import type { AgentRefs } from '../package/agent';
import { ARCHIVE_COPY, META_FILE } from '../package/layout';

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
  /** Write raw bytes. Required for skills and agents (their archive copy is binary). */
  writeBytes?(path: string, bytes: Uint8Array): void | Promise<void>;
  /** Remove a directory and its contents if present. */
  removeDir?(path: string): void | Promise<void>;
  /** Remove a single file if present. */
  removeFile?(path: string): void | Promise<void>;
  /** Read a UTF-8 file, or null if absent; used to merge the workspace prompd.json. */
  readFile?(path: string): Promise<string | null> | string | null;
  /** Read raw bytes. */
  readBytes?(path: string): Promise<Uint8Array> | Uint8Array;
  /** List a directory's entry names. */
  readdir?(path: string): Promise<string[]> | string[];
}

export interface InstallPackageOptions {
  /** "@scope/name@version" or "@scope/name" (latest). */
  ref: string;
  /** Install root: the open workspace (local) or the home dir (global). */
  root: string;
  /** Writable sink for the chosen host. */
  store: PackageStore;
  /** Fetch the .pdpkg bytes for (name, version spec). Resolves latest, exact and ranges. */
  download: PackageDownloader;
  /** Global install: skips the workspace prompd.json dependency record (CLI parity). */
  global?: boolean;
  /** Deploy the installed skill to these tools (skills only), via deployTool. */
  tools?: string[];
  /** Host hook performing the per-tool deploy. Required when `tools` is set. */
  deployTool?: ToolDeployHook;
  /** One dot-directory the tree lives under, or '' when root is already the state dir. Default '.prompd'. */
  installDir?: string;
  /** Lockfile pins, "name@version" -> "sha256:<hex>". A pinned package whose archive differs is refused. */
  pins?: ReadonlyMap<string, string>;
}

export interface InstalledPackage {
  /** Full scoped name, from the verified manifest. */
  name: string;
  /** Exact version, from the verified manifest. */
  version: string;
  scope?: string;
  type: PackageType;
  /** The version directory. */
  installedPath: string;
  /** Package-relative paths of the package's own files that were written. */
  files: string[];
  /** "sha256:<hex>" of the archive. */
  digest: string;
  /** The dependencies this install resolved, each with its own tree. */
  dependencies: InstalledPackage[];
  /** What the package needs from the machine (MCP servers, built-in skills); checked by the host. */
  requires?: PackageRequires;
}

/** Caps on one install tree, checked while resolving, before anything is written. */
export const INSTALL_LIMITS = {
  /** Dependencies one manifest may declare. */
  maxDependencies: 100,
  /** Packages in one install tree, the requested package included. */
  maxPackages: 500,
  /** Unpacked bytes across the whole tree (1 GiB). */
  maxTotalBytes: 1024 * 1024 * 1024,
} as const;

/** The CLI layout's install dir. Hosts with their own state dir override it. */
const DEFAULT_INSTALL_DIR = '.prompd';

/** Types resolved by bare name on the host (crew/<name>, skills/<name>); their
 * installs must be re-verifiable, so they need the archive copy. */
const NAME_RESOLVED: ReadonlySet<PackageType> = new Set<PackageType>(['skill', 'agent']);

const textDecoder = new TextDecoder('utf-8', { fatal: true });

/** One dot-directory segment, or '' for "root is the state dir". Nothing that can climb or nest. */
function checkInstallDir(dir: string | undefined): string {
  const d = dir ?? DEFAULT_INSTALL_DIR;
  if (d !== '' && !/^\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(d)) {
    throw new Error(`Invalid installDir "${d}": expected a single dot-directory name like ".prompd", or "" when root is the state directory.`);
  }
  return d;
}

function resolvePackageDir(root: string, installDir: string, type: PackageType, name: string): string {
  return joinPosix(root, installDir, getInstallDirForType(type), name);
}

function resolveInstallDir(root: string, installDir: string, type: PackageType, name: string, version: string): string {
  return joinPosix(resolvePackageDir(root, installDir, type, name), version);
}

/** "@scope/name", "@scope/name@1.2.3" or "@scope/name@^1.2.0". parsePackageReference
 * cannot be used here: its pattern rejects ^ and ~, so a range never parsed. */
function splitRef(ref: string): { name: string; spec: string } {
  const at = ref.lastIndexOf('@');
  const name = at > 0 ? ref.slice(0, at) : ref;
  const spec = at > 0 ? ref.slice(at + 1) : 'latest';
  if (!PACKAGE_NAME_RE.test(name)) throw new Error(`Invalid package reference format: ${ref}`);
  if (spec !== 'latest' && semver.validRange(spec) === null) throw new Error(`Invalid version "${spec}" in ${ref}`);
  return { name, spec };
}

function scopeOf(name: string): string | undefined {
  const m = /^(@[\w.-]+)\//.exec(name);
  return m ? m[1] : undefined;
}

/* ---- workspace prompd.json dependency tracking (CLI parity). NON-FATAL. ---- */

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

/** An agent's dependency must be the kind its definition uses it as. */
function checkDependencyTypes(owner: string, refs: AgentRefs, deps: readonly { name: string; type: PackageType }[]): void {
  for (const d of deps) {
    const short = unscopedName(d.name);
    if (refs.skills.includes(short) && d.type !== 'skill') {
      throw new PackageVerificationError('TYPE_INVALID', `${owner} uses ${d.name} as a skill, but it is a ${d.type}`);
    }
    if (refs.agents.includes(short) && d.type !== 'agent') {
      throw new PackageVerificationError('TYPE_INVALID', `${owner} calls ${d.name} as an agent, but it is a ${d.type}`);
    }
  }
}

/** A package that passed every check, ready to write. */
interface ResolvedNode {
  pkg: VerifiedPackage;
  archive: Uint8Array;
  texts: Map<string, string>;
  dependencies: ResolvedNode[];
}

interface ResolveState {
  /** Resolved nodes by name: a dependency reached twice is installed once. */
  done: Map<string, ResolvedNode>;
  /** Names being resolved right now, with their version: reaching one again is a cycle. */
  active: Map<string, string>;
  /** Packages opened so far and their unpacked bytes, against INSTALL_LIMITS. */
  packages: number;
  bytes: number;
}

/** The highest pinned version of `name` that `spec` accepts, with its pinned digest. */
function pinFor(pins: ReadonlyMap<string, string> | undefined, name: string, spec: string): { version: string; digest: string } | null {
  if (!pins) return null;
  const prefix = `${name}@`;
  const versions: string[] = [];
  for (const key of pins.keys()) {
    if (!key.startsWith(prefix)) continue;
    const v = key.slice(prefix.length);
    if (semver.valid(v) !== null) versions.push(v);
  }
  const best = spec === 'latest' ? (semver.rsort(versions)[0] ?? null) : semver.maxSatisfying(versions, spec);
  if (best === null) return null;
  return { version: best, digest: pins.get(`${prefix}${best}`) as string };
}

function treeTooLarge(message: string): PackageVerificationError {
  return new PackageVerificationError('TOO_LARGE', message);
}

/** A name already in this install must be a version the new requirer accepts. */
function checkSharedVersion(depName: string, owner: string, spec: string, resolved: string): void {
  if (spec === 'latest' || semver.satisfies(resolved, spec)) return;
  throw new Error(`${depName}: ${owner} needs ${spec}, but ${resolved} is already part of this install`);
}

/**
 * Install a registry artifact. Phase 1 downloads and verifies the whole tree
 * (integrity, requested name and version range, lockfile pin, store capability,
 * agent dependency types) without touching the store. Phase 2 writes it,
 * dependencies before dependents.
 */
export async function installPackage(opts: InstallPackageOptions): Promise<InstalledPackage> {
  const { name, spec } = splitRef(opts.ref);
  checkInstallDir(opts.installDir);
  const root = await resolveNode(opts, name, spec, { done: new Map(), active: new Map(), packages: 0, bytes: 0 });
  const result = await writeNode(opts, root, new Map());
  // Only the requested package is the workspace's dependency; its own dependencies are its business.
  if (!opts.global) await addWorkspaceDependency(opts.store, opts.root, result.name, result.version);
  return result;
}

async function resolveNode(
  opts: InstallPackageOptions,
  wantName: string,
  wantSpec: string,
  state: ResolveState,
): Promise<ResolvedNode> {
  const { store, download, pins } = opts;

  // A lockfile pin the spec accepts holds the version: fetch exactly that one and
  // require its bytes to be the pinned bytes, instead of whatever is newest.
  const pin = pinFor(pins, wantName, wantSpec);
  const archive = await download(wantName, pin ? pin.version : wantSpec);
  const range = pin ? pin.version : semver.validRange(wantSpec) !== null ? wantSpec : undefined;
  const pkg = await openPdpkg(archive, { name: wantName, ...(range !== undefined ? { range } : {}), ...(pin ? { digest: pin.digest } : {}) });
  const { name, version, type } = pkg.manifest;

  state.packages += 1;
  if (state.packages > INSTALL_LIMITS.maxPackages) throw treeTooLarge(`the install tree holds more than ${INSTALL_LIMITS.maxPackages} packages`);
  state.bytes += pkg.manifestBytes.length;
  for (const b of pkg.files.values()) state.bytes += b.length;
  if (state.bytes > INSTALL_LIMITS.maxTotalBytes) throw treeTooLarge(`the install tree is over ${INSTALL_LIMITS.maxTotalBytes} bytes unpacked`);
  const declared = Object.keys(pkg.manifest.dependencies ?? {}).length;
  if (declared > INSTALL_LIMITS.maxDependencies) throw treeTooLarge(`${name}@${version} declares ${declared} dependencies (max ${INSTALL_LIMITS.maxDependencies})`);

  const pinned = pins?.get(`${name}@${version}`);
  if (pinned !== undefined && pinned !== pkg.digest) {
    throw new PackageVerificationError('DIGEST_MISMATCH', `${name}@${version} does not match the digest recorded in the lockfile (${pinned})`);
  }
  if (pkg.files.size === 0) throw new Error(`Package "${name}" contains no installable files.`);

  if (NAME_RESOLVED.has(type) && !store.writeBytes) {
    throw new Error(`Installing a ${type} needs a store that can write bytes; ${name}@${version} was not installed.`);
  }
  const texts = new Map<string, string>();
  if (!store.writeBytes) {
    for (const [p, b] of pkg.files) {
      try { texts.set(p, textDecoder.decode(b)); }
      catch { throw new Error(`${name}@${version} contains a binary file (${p}) and this host can only store text. Not installed.`); }
    }
  }

  const node: ResolvedNode = { pkg, archive, texts, dependencies: [] };
  state.active.set(name, version);
  for (const [depName, depSpec] of Object.entries(pkg.manifest.dependencies ?? {})) {
    if (depName === name) continue;
    const activeVersion = state.active.get(depName);
    if (activeVersion !== undefined) { // a cycle: the ancestor is already being installed
      checkSharedVersion(depName, name, depSpec, activeVersion);
      continue;
    }
    const done = state.done.get(depName);
    if (done) {
      checkSharedVersion(depName, name, depSpec, done.pkg.manifest.version);
      node.dependencies.push(done);
      continue;
    }
    node.dependencies.push(await resolveNode(opts, depName, depSpec, state));
  }
  if (pkg.agentRefs) checkDependencyTypes(name, pkg.agentRefs, node.dependencies.map((d) => d.pkg.manifest));

  state.active.delete(name);
  state.done.set(name, node);
  return node;
}

async function writeNode(
  opts: InstallPackageOptions,
  node: ResolvedNode,
  written: Map<ResolvedNode, InstalledPackage>,
): Promise<InstalledPackage> {
  const prior = written.get(node);
  if (prior) return prior;
  const { root, store, tools, deployTool } = opts;
  const installDir = checkInstallDir(opts.installDir);
  const { pkg, archive, texts } = node;
  const { name, version, type } = pkg.manifest;

  const dependencies: InstalledPackage[] = [];
  for (const dep of node.dependencies) dependencies.push(await writeNode(opts, dep, written));

  const installedPath = resolveInstallDir(root, installDir, type, name, version);
  const base = normalizePosix(installedPath);
  const destOf = (rel: string): string => {
    const dest = joinPosix(installedPath, rel); // joinPosix resolves '..', so an escape leaves `base`
    if (dest !== base && !dest.startsWith(base + '/')) {
      throw new PackageVerificationError('UNSAFE_PATH', `${rel} escapes the install directory`, rel);
    }
    return dest;
  };

  await store.removeDir?.(installedPath); // clean reinstall of this version
  const files: string[] = [];
  for (const [rel, b] of pkg.files) {
    const dest = destOf(rel);
    if (store.writeBytes) await store.writeBytes(dest, b);
    else await store.writeFile(dest, texts.get(rel) as string);
    files.push(rel);
  }
  const manifestPath = joinPosix(installedPath, 'prompd.json');
  if (store.writeBytes) {
    await store.writeBytes(manifestPath, pkg.manifestBytes);
    await store.writeBytes(joinPosix(installedPath, ARCHIVE_COPY), archive);
  } else {
    await store.writeFile(manifestPath, textDecoder.decode(pkg.manifestBytes));
  }
  await store.writeFile(joinPosix(installedPath, META_FILE), JSON.stringify({ name, version, type, digest: pkg.digest }, null, 2) + '\n');

  if (tools && tools.length > 0) {
    if (type !== 'skill') throw new Error(`Tool deploy is only valid for skills, but '${name}' is a ${type}.`);
    if (!deployTool) throw new Error('tools were requested but no deployTool hook was provided.');
    for (const tool of tools) await deployTool({ installedPath, name, tool });
  }


  const result: InstalledPackage = {
    name, version, ...(scopeOf(name) ? { scope: scopeOf(name) } : {}), type, installedPath, files, digest: pkg.digest, dependencies,
    ...(pkg.manifest.requires ? { requires: pkg.manifest.requires } : {}),
  };
  written.set(node, result);
  return result;
}

export interface UninstallPackageOptions {
  /** "@scope/name" (a version suffix is accepted but ignored). */
  ref: string;
  /** Install root the caller chose. */
  root: string;
  /** Writable sink for the chosen host. */
  store: PackageStore;
  /** Global uninstall: skips the workspace prompd.json dependency removal. */
  global?: boolean;
  /** Same meaning as InstallPackageOptions.installDir. */
  installDir?: string;
}

export interface UninstalledPackage {
  name: string;
  scope?: string;
  /** Dirs removed. */
  removed: string[];
}

/** Uninstall by name: remove the package's dir (all versions) under every type
 * dir, and drop the prompd.json dependency. Idempotent. */
export async function uninstallPackage(opts: UninstallPackageOptions): Promise<UninstalledPackage> {
  const { root, store, global } = opts;
  const installDir = checkInstallDir(opts.installDir);
  if (!store.removeDir) throw new Error('Uninstall requires a PackageStore with removeDir.');
  const { name } = splitRef(opts.ref);
  const removed: string[] = [];
  for (const type of ['package', 'workflow', 'skill', 'agent'] as PackageType[]) {
    const dir = resolvePackageDir(root, installDir, type, name);
    await store.removeDir(dir);
    removed.push(dir);
  }
  if (!global) await removeWorkspaceDependency(store, root, name);
  const scope = scopeOf(name);
  return { name, ...(scope ? { scope } : {}), removed };
}
