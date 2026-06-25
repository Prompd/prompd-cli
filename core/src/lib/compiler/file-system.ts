/**
 * File System Abstraction (core, environment-agnostic).
 *
 * Defines the IFileSystem interface and the in-memory implementation used for
 * browser + server compilation. The Node-backed NodeFileSystem and the adm-zip
 * .pdpkg helpers live in @prompd/cli (they need Node APIs). Path operations here
 * are inlined as POSIX so this module has zero Node imports.
 */
import JSZip from 'jszip';

/**
 * File system interface that can be implemented for different storage backends.
 */
export interface IFileSystem {
  /** Check if a file or directory exists. */
  exists(filePath: string): boolean | Promise<boolean>;
  /** Read a file's contents as a UTF-8 string. */
  readFile(filePath: string): string | Promise<string>;
  /** Check if a path is a directory. */
  isDirectory(filePath: string): boolean | Promise<boolean>;
  /** List files in a directory. */
  readdir(dirPath: string): string[] | Promise<string[]>;
  /** Resolve a path (for package resolution). */
  resolve(...pathSegments: string[]): string;
  /** Get the directory name of a path. */
  dirname(filePath: string): string;
  /** Join path segments. */
  join(...pathSegments: string[]): string;
}

/** Extensions whose bytes can't live in the string-backed FS — skipped on package
 * ingest. Compilation only needs the text sources; binary assets are resolved
 * server-side (the browser warns) for now. */
const BINARY_ASSET_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff',
  'pdf', 'xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt',
  'zip', 'pdpkg', 'gz', 'tar', 'wasm', 'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'wav', 'ogg', 'webm', 'mov', 'avi',
]);
function isBinaryAsset(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && BINARY_ASSET_EXT.has(name.slice(dot + 1).toLowerCase());
}

/**
 * Extract a `.pdpkg` (ZIP) buffer to a flat map of entry-relative path -> UTF-8
 * content. The SINGLE ZIP-extraction primitive shared by package ingestion
 * (MemoryFileSystem.addPackage) and skill install — so hosts never hand-roll their
 * own jszip pass. Directories and binary assets are skipped (the consumers store
 * text only).
 */
export async function extractPdpkg(buffer: Uint8Array): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const out = new Map<string, string>();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || isBinaryAsset(entry.name)) continue;
    out.set(entry.name, await entry.async('string'));
  }
  return out;
}

/* ---- inlined POSIX path helpers (no Node 'path' dependency) ---- */

function normalizePosix(p: string): string {
  const isAbs = p.startsWith('/');
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!isAbs) out.push('..');
    } else {
      out.push(seg);
    }
  }
  const joined = out.join('/');
  return isAbs ? '/' + joined : (joined || '.');
}

function joinPosix(...segments: string[]): string {
  const filtered = segments.filter((s) => s && s.length > 0);
  if (filtered.length === 0) return '.';
  return normalizePosix(filtered.join('/'));
}

function dirnamePosix(p: string): string {
  const norm = p.replace(/\/+$/, '');
  const idx = norm.lastIndexOf('/');
  if (idx === -1) return '.';
  if (idx === 0) return '/';
  return norm.slice(0, idx);
}

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Relative key normalization (forward slashes, no leading ./ or /, no trailing
 * slash) shared by MemoryFileSystem and HybridFileSystem so they never drift. */
function toRelKey(filePath: string): string {
  let n = filePath.replace(/\\/g, '/');
  if (n.startsWith('./')) n = n.substring(2);
  if (n.startsWith('/')) n = n.substring(1);
  if (n.endsWith('/') && n.length > 1) n = n.substring(0, n.length - 1);
  return n;
}

/**
 * In-memory file system for browser + server-side compilation.
 * Files are provided as a map of path -> content.
 */
export class MemoryFileSystem implements IFileSystem {
  /** Cap on an ingested package buffer (defends against a hostile/huge .pdpkg). */
  private static readonly MAX_PACKAGE_SIZE = 50 * 1024 * 1024;
  private files: Map<string, string>;

  constructor(files: Record<string, string> = {}) {
    this.files = new Map();
    for (const [filePath, content] of Object.entries(files)) {
      this.addFile(filePath, content);
    }
  }

  /** Add or update a file in the in-memory file system. */
  addFile(filePath: string, content: string): void {
    this.files.set(this.normalizePath(filePath), content);
  }

  /** Add multiple files at once. */
  addFiles(files: Record<string, string>): void {
    for (const [filePath, content] of Object.entries(files)) {
      this.addFile(filePath, content);
    }
  }

  exists(filePath: string): boolean {
    return this.files.has(this.normalizePath(filePath));
  }

  readFile(filePath: string): string {
    const normalizedPath = this.normalizePath(filePath);
    const content = this.files.get(normalizedPath);
    if (content === undefined) {
      throw new Error(`File not found: ${filePath}`);
    }
    return content;
  }

  isDirectory(filePath: string): boolean {
    const normalizedPath = this.normalizePath(filePath);
    const dirPrefix = normalizedPath.endsWith('/') ? normalizedPath : normalizedPath + '/';
    for (const file of this.files.keys()) {
      if (file.startsWith(dirPrefix)) {
        return true;
      }
    }
    return false;
  }

  readdir(dirPath: string): string[] {
    const normalizedDir = this.normalizePath(dirPath);
    const dirPrefix = normalizedDir.endsWith('/') ? normalizedDir : normalizedDir + '/';
    const files: Set<string> = new Set();
    for (const file of this.files.keys()) {
      if (file.startsWith(dirPrefix)) {
        const relativePath = file.substring(dirPrefix.length);
        const slashIndex = relativePath.indexOf('/');
        const fileName = slashIndex === -1 ? relativePath : relativePath.substring(0, slashIndex);
        if (fileName) {
          files.add(fileName);
        }
      }
    }
    return Array.from(files);
  }

  resolve(...pathSegments: string[]): string {
    return joinPosix('/', ...pathSegments);
  }

  dirname(filePath: string): string {
    return dirnamePosix(filePath);
  }

  join(...pathSegments: string[]): string {
    return joinPosix(...pathSegments);
  }

  /** Get the virtual file system path for a package. */
  getPackagePath(packageName: string, version: string): string {
    return `/packages/${packageName}@${version}`;
  }

  /**
   * Extract a `.pdpkg` (ZIP) buffer into memory under getPackagePath(name, ver).
   *
   * Uses JSZip — isomorphic (browser + Node) — so this is the SINGLE package-ingest
   * path for every host (replacing the CLI's Node-only adm-zip subclass and the
   * skill installer's ad-hoc unzip). Text files only: binary assets aren't
   * representable in the string-backed FS, so they're skipped (a `using:` package's
   * .prmd/.md/.json/.yaml is what matters for compilation). Validates entry paths
   * can't escape the package directory.
   */
  async addPackage(packageName: string, version: string, packageBuffer: Uint8Array): Promise<void> {
    if (packageBuffer.length > MemoryFileSystem.MAX_PACKAGE_SIZE) {
      throw new Error(`Package too large: ${packageBuffer.length} bytes (max ${MemoryFileSystem.MAX_PACKAGE_SIZE})`);
    }
    const files = await extractPdpkg(packageBuffer);

    const packagePath = this.getPackagePath(packageName, version);
    const packagePrefix = this.normalizePath(packagePath.endsWith('/') ? packagePath : packagePath + '/');
    const packageRoot = this.normalizePath(packagePath);

    for (const [rel, content] of files) {
      const filePath = this.join(packagePath, rel);
      const normalized = this.normalizePath(filePath);
      if (!normalized.startsWith(packagePrefix) && normalized !== packageRoot) {
        throw new Error(`Security violation: extracted path escapes package directory: ${rel}`);
      }
      this.addFile(filePath, content);
    }
  }

  /** Get all files under an optional base path. */
  getAllFiles(basePath?: string): Map<string, string> {
    if (!basePath) {
      return new Map(this.files);
    }
    const normalizedBase = this.normalizePath(basePath);
    const prefix = normalizedBase.endsWith('/') ? normalizedBase : normalizedBase + '/';
    const filtered = new Map<string, string>();
    for (const [filePath, content] of this.files.entries()) {
      if (filePath.startsWith(prefix) || filePath === normalizedBase) {
        filtered.set(filePath, content);
      }
    }
    return filtered;
  }

  /** Calculate total size (bytes) and file count under a base path. */
  getTotalSize(basePath: string): { size: number; files: number } {
    const files = this.getAllFiles(basePath);
    let totalSize = 0;
    for (const content of files.values()) {
      totalSize += utf8ByteLength(content);
    }
    return { size: totalSize, files: files.size };
  }

  /** Normalize path to forward slashes, drop leading ./ and /, no trailing slash. */
  protected normalizePath(filePath: string): string {
    return toRelKey(filePath);
  }
}

/**
 * Async backend for files NOT held in memory by a HybridFileSystem. Paths are
 * normalized relative keys (forward slashes, no leading ./ or /), matching the
 * keys MemoryFileSystem uses. readFile resolves null when the file is absent.
 *
 * This is how a host streams files lazily — e.g. a browser
 * FileSystemDirectoryHandle, or a registry/package fetch — without loading the
 * whole tree up front.
 */
export interface AsyncFileBackend {
  /** Read a file's UTF-8 contents; resolve null when it does not exist. */
  readFile(path: string): Promise<string | null>;
  /** Optional: report whether a path is a directory. */
  isDirectory?(path: string): Promise<boolean>;
  /** Optional: list a directory's immediate entry names. */
  readdir?(path: string): Promise<string[]>;
}

/**
 * In-memory file system with an async fall-through backend.
 *
 * Files placed in memory (constructor map / addFile) are served SYNCHRONOUSLY,
 * so the synchronous Nunjucks {% include %} loader keeps working for them —
 * pre-load the .prmd sources a compilation can {% include %} or inherit. Any
 * path NOT in memory is read from the async backend, returning a Promise that
 * the compiler's awaiting stages (inherits:, package context, asset extraction)
 * consume. This lets a browser compile a folder of prompts: load the .prmd
 * sources up front, stream binary/context assets on demand.
 *
 * Known limitation: the synchronous Nunjucks {% include %} loader cannot read
 * backend-only files (it gets a Promise and throws a "requires synchronous"
 * error). So anything {% include %}'d must be in memory — pre-load every source
 * a compilation can include (the web host pre-loads all .prmd/.md). inherits:
 * has no such limit; it resolves through the async stages.
 *
 * Composes (does not extend) MemoryFileSystem so the in-memory methods keep
 * their strict sync return types and existing consumers are untouched.
 */
export class HybridFileSystem implements IFileSystem {
  private mem: MemoryFileSystem;
  private backend: AsyncFileBackend;

  constructor(files: Record<string, string> = {}, backend: AsyncFileBackend) {
    this.mem = new MemoryFileSystem(files);
    this.backend = backend;
  }

  /** Add or update an in-memory (synchronously-served) file. */
  addFile(filePath: string, content: string): void {
    this.mem.addFile(filePath, content);
  }

  /** Add multiple in-memory files at once. */
  addFiles(files: Record<string, string>): void {
    this.mem.addFiles(files);
  }

  /** Virtual path where a package's files live (delegates to the memory layer). */
  getPackagePath(packageName: string, version: string): string {
    return this.mem.getPackagePath(packageName, version);
  }

  /** Ingest a `.pdpkg` (ZIP) buffer into the in-memory layer, so package files are
   * served synchronously alongside the workspace sources. */
  addPackage(packageName: string, version: string, packageBuffer: Uint8Array): Promise<void> {
    return this.mem.addPackage(packageName, version, packageBuffer);
  }

  exists(filePath: string): boolean | Promise<boolean> {
    if (this.mem.exists(filePath)) return true;
    return this.backend
      .readFile(this.normalize(filePath))
      .then((content) => content !== null)
      .catch(() => false);
  }

  readFile(filePath: string): string | Promise<string> {
    if (this.mem.exists(filePath)) return this.mem.readFile(filePath);
    return this.backend.readFile(this.normalize(filePath)).then((content) => {
      if (content === null) throw new Error(`File not found: ${filePath}`);
      return content;
    });
  }

  isDirectory(filePath: string): boolean | Promise<boolean> {
    if (this.mem.isDirectory(filePath)) return true;
    if (!this.backend.isDirectory) return false;
    return this.backend.isDirectory(this.normalize(filePath)).catch(() => false);
  }

  readdir(dirPath: string): string[] | Promise<string[]> {
    const local = this.mem.readdir(dirPath);
    if (!this.backend.readdir) return local;
    return this.backend
      .readdir(this.normalize(dirPath))
      .then((remote) => Array.from(new Set([...local, ...remote])))
      .catch(() => local);
  }

  resolve(...pathSegments: string[]): string {
    return this.mem.resolve(...pathSegments);
  }

  dirname(filePath: string): string {
    return this.mem.dirname(filePath);
  }

  join(...pathSegments: string[]): string {
    return this.mem.join(...pathSegments);
  }

  /** Normalize to the same relative keys MemoryFileSystem uses, for backend lookups. */
  private normalize(filePath: string): string {
    return toRelKey(filePath);
  }
}
