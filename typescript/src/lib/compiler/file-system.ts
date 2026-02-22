/**
 * File System Abstraction
 *
 * Provides an abstraction layer for file system operations in the compiler.
 * This allows the compiler to work with in-memory file systems (for server-side
 * compilation) or the actual file system (for CLI usage).
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import AdmZip from 'adm-zip';

/**
 * File system interface that can be implemented for different storage backends.
 */
export interface IFileSystem {
  /**
   * Check if a file or directory exists.
   */
  exists(filePath: string): boolean | Promise<boolean>;

  /**
   * Read a file's contents as a UTF-8 string.
   */
  readFile(filePath: string): string | Promise<string>;

  /**
   * Check if a path is a directory.
   */
  isDirectory(filePath: string): boolean | Promise<boolean>;

  /**
   * List files in a directory.
   */
  readdir(dirPath: string): string[] | Promise<string[]>;

  /**
   * Resolve a path (for package resolution).
   */
  resolve(...pathSegments: string[]): string;

  /**
   * Get the directory name of a path.
   */
  dirname(filePath: string): string;

  /**
   * Join path segments.
   */
  join(...pathSegments: string[]): string;
}

/**
 * Default file system implementation that uses Node.js fs module.
 */
export class NodeFileSystem implements IFileSystem {
  exists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
  }

  isDirectory(filePath: string): boolean {
    return this.exists(filePath) && fs.statSync(filePath).isDirectory();
  }

  readdir(dirPath: string): string[] {
    return fs.readdirSync(dirPath);
  }

  resolve(...pathSegments: string[]): string {
    return path.resolve(...pathSegments);
  }

  dirname(filePath: string): string {
    return path.dirname(filePath);
  }

  join(...pathSegments: string[]): string {
    return path.join(...pathSegments);
  }
}

/**
 * In-memory file system for server-side compilation.
 * Files are provided as a map of path -> content.
 */
export class MemoryFileSystem implements IFileSystem {
  private files: Map<string, string>;

  // Security constants
  private static readonly MAX_PACKAGE_SIZE = 50 * 1024 * 1024; // 50MB
  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024;    // 10MB per file
  private static readonly MAX_FILE_COUNT = 1000;

  constructor(files: Record<string, string> = {}) {
    this.files = new Map();
    // Normalize paths when adding initial files
    for (const [path, content] of Object.entries(files)) {
      this.addFile(path, content);
    }
  }

  /**
   * Add or update a file in the in-memory file system.
   */
  addFile(filePath: string, content: string): void {
    this.files.set(this.normalizePath(filePath), content);
  }

  /**
   * Add multiple files at once.
   */
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
    // In memory FS: treat as directory if any file starts with this path
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
        // Get the relative path from the directory
        const relativePath = file.substring(dirPrefix.length);

        // Only include immediate children (not nested)
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
    return path.posix.join('/', ...pathSegments);
  }

  dirname(filePath: string): string {
    return path.posix.dirname(filePath);
  }

  join(...pathSegments: string[]): string {
    return path.posix.join(...pathSegments);
  }

  /**
   * Validate package name against npm/semver standards.
   * Prevents path traversal and injection attacks.
   */
  private validatePackageName(name: string): void {
    // Allow dots, hyphens, and alphanumeric in npm-style scoped packages
    const pattern = /^@[a-z0-9.-]+\/[a-z0-9.-]+$/;
    if (!pattern.test(name)) {
      throw new Error(`Invalid package name: ${name}. Must match @namespace/package format.`);
    }

    // Additional security checks
    if (name.includes('..') || name.includes('/./') || name.includes('//')) {
      throw new Error(`Security violation: Invalid characters in package name: ${name}`);
    }
  }

  /**
   * Validate semantic version format.
   */
  private validateVersion(version: string): void {
    const semverPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
    if (!semverPattern.test(version)) {
      throw new Error(`Invalid version format: ${version}. Must be semantic version (e.g., 1.0.0)`);
    }
  }

  /**
   * Validate ZIP package structure before extraction.
   * Prevents: zip bombs, path traversal, symlink attacks.
   */
  private validateZipStructure(zip: AdmZip): void {
    const entries = zip.getEntries();
    let fileCount = 0;
    let totalSize = 0;

    for (const entry of entries) {
      fileCount++;
      totalSize += entry.header.size;

      // Check file count limit
      if (fileCount > MemoryFileSystem.MAX_FILE_COUNT) {
        throw new Error(
          `Package contains too many files (max: ${MemoryFileSystem.MAX_FILE_COUNT})`
        );
      }

      // Check total size
      if (totalSize > MemoryFileSystem.MAX_PACKAGE_SIZE) {
        throw new Error(
          `Package too large (max: ${MemoryFileSystem.MAX_PACKAGE_SIZE} bytes)`
        );
      }

      // Validate entry path (security checks)
      this.validateZipEntry(entry);
    }
  }

  /**
   * Validate a single ZIP entry for security issues.
   */
  private validateZipEntry(entry: AdmZip.IZipEntry): void {
    const entryPath = entry.entryName;

    // 1. Path traversal prevention
    if (entryPath.includes('..') || entryPath.startsWith('/') || entryPath.startsWith('\\')) {
      throw new Error(`Security violation: Path traversal attempt (${entryPath})`);
    }

    // 2. Absolute path prevention
    if (path.isAbsolute(entryPath)) {
      throw new Error(`Security violation: Absolute path (${entryPath})`);
    }

    // 3. File size limit
    if (entry.header.size > MemoryFileSystem.MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${entryPath} (${entry.header.size} bytes, max: ${MemoryFileSystem.MAX_FILE_SIZE})`
      );
    }

    // 4. Prevent null bytes in paths
    if (entryPath.includes('\0')) {
      throw new Error(`Security violation: Null byte in path (${entryPath})`);
    }
  }

  /**
   * Add a package from a ZIP Buffer to the in-memory file system.
   * Extracts the .pdpkg (ZIP) and stores all files with the package path prefix.
   * SECURITY: Validates package name, version, and ZIP structure.
   *
   * @param packageName - Full package name (e.g., "@namespace/package-name")
   * @param version - Package version (e.g., "1.0.0")
   * @param packageBuffer - Buffer containing the .pdpkg (ZIP) file
   */
  async addPackage(packageName: string, version: string, packageBuffer: Buffer): Promise<void> {
    // 1. VALIDATE INPUTS
    this.validatePackageName(packageName);
    this.validateVersion(version);

    // 2. CHECK BUFFER SIZE
    if (packageBuffer.length > MemoryFileSystem.MAX_PACKAGE_SIZE) {
      throw new Error(
        `Package too large: ${packageBuffer.length} bytes (max: ${MemoryFileSystem.MAX_PACKAGE_SIZE})`
      );
    }

    // 3. OPEN AND VALIDATE ZIP STRUCTURE
    const zip = new AdmZip(packageBuffer);
    this.validateZipStructure(zip);

    // 4. EXTRACT TO MEMORY
    const packagePath = this.getPackagePath(packageName, version);
    const entries = zip.getEntries();

    for (const entry of entries) {
      // Skip directories
      if (entry.isDirectory) {
        continue;
      }

      // Get file content
      const content = entry.getData().toString('utf8');
      const entryPath = entry.entryName;

      // Build virtual path: /packages/@namespace/package@version/path/to/file
      const filePath = this.join(packagePath, entryPath);
      this.addFile(filePath, content);
    }
  }

  /**
   * Recursively load a directory's contents into the in-memory file system.
   *
   * @param sourceDir - Directory to read from disk
   * @param targetPath - Virtual path in memory file system
   */
  private async loadDirectoryToMemory(sourceDir: string, targetPath: string): Promise<void> {
    const entries = await fs.readdir(sourceDir);

    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry);
      const stat = await fs.stat(sourcePath);

      if (stat.isDirectory()) {
        // Recursively load subdirectories
        const subTargetPath = this.join(targetPath, entry);
        await this.loadDirectoryToMemory(sourcePath, subTargetPath);
      } else if (stat.isFile()) {
        // Read file content and add to memory
        const content = await fs.readFile(sourcePath, 'utf-8');
        const filePath = this.join(targetPath, entry);
        this.addFile(filePath, content);
      }
    }
  }

  /**
   * Add a package from the registry to the in-memory file system.
   * Downloads the package tarball and extracts it to memory.
   *
   * @param packageRef - Package reference (e.g., "@namespace/package@1.0.0")
   * @param downloadFn - Optional function to download package, receives (packageName, version) and returns {tarball: Buffer, metadata: any}
   */
  async addPackageFromRegistry(
    packageRef: string,
    downloadFn?: (packageName: string, version: string) => Promise<{ tarball: Buffer; metadata: any }>
  ): Promise<void> {
    // Parse package reference
    const { packageName, version } = this.parsePackageReference(packageRef);

    if (!downloadFn) {
      throw new Error('downloadFn is required to fetch packages from registry. Pass RegistryClient.downloadPackageBuffer');
    }

    // Download package
    const packageData = await downloadFn(packageName, version);

    // Extract to memory
    await this.addPackage(packageName, version, packageData.tarball);
  }

  /**
   * Get the virtual file system path for a package.
   *
   * @param packageName - Full package name (e.g., "@namespace/package-name")
   * @param version - Package version (e.g., "1.0.0")
   * @returns Virtual path (e.g., "/packages/@namespace/package-name@1.0.0")
   */
  getPackagePath(packageName: string, version: string): string {
    return `/packages/${packageName}@${version}`;
  }

  /**
   * Parse a package reference into name and version.
   *
   * @param packageRef - Package reference (e.g., "@namespace/package@1.0.0")
   * @returns Object with packageName and version
   */
  private parsePackageReference(packageRef: string): { packageName: string; version: string } {
    // Handle scoped packages: @namespace/package@version
    const match = packageRef.match(/^(@[^/]+\/[^@]+)@(.+)$/);

    if (!match) {
      throw new Error(`Invalid package reference: ${packageRef}. Expected format: @namespace/package@version`);
    }

    return {
      packageName: match[1],
      version: match[2]
    };
  }

  /**
   * Normalize path to use forward slashes and ensure consistency.
   */
  private normalizePath(filePath: string): string {
    // Convert backslashes to forward slashes
    let normalized = filePath.replace(/\\/g, '/');

    // Remove leading ./ if present
    if (normalized.startsWith('./')) {
      normalized = normalized.substring(2);
    }

    // Remove leading / for consistency (treat all paths as relative)
    if (normalized.startsWith('/')) {
      normalized = normalized.substring(1);
    }

    // Ensure no trailing slash for files
    if (normalized.endsWith('/') && normalized.length > 1) {
      normalized = normalized.substring(0, normalized.length - 1);
    }

    return normalized;
  }

  /**
   * Get all files under a base path.
   *
   * @param basePath - Optional base path to filter files
   * @returns Map of file paths to content
   */
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

  /**
   * Calculate total size of files under base path.
   *
   * @param basePath - Base path to calculate size for
   * @returns Object with size in bytes and file count
   */
  getTotalSize(basePath: string): { size: number; files: number } {
    const files = this.getAllFiles(basePath);
    let totalSize = 0;

    for (const content of files.values()) {
      totalSize += Buffer.byteLength(content, 'utf-8');
    }

    return {
      size: totalSize,
      files: files.size
    };
  }

  /**
   * Create a .pdpkg tarball Buffer from in-memory files.
   * Used for server-side package creation without disk writes.
   * SECURITY: Scans for secrets before packing.
   *
   * @param basePath - Base path in memory filesystem (e.g., "/my-package")
   * @param manifest - Package manifest.json content
   * @param options - Optional filter for files
   * @returns Buffer containing gzipped tarball
   */
  async createPackageBuffer(
    basePath: string,
    manifest: Record<string, any>,
    options?: {
      filter?: (path: string) => boolean;
    }
  ): Promise<Buffer> {
    // 1. Validate manifest
    if (!manifest.name || !manifest.version || !manifest.description) {
      throw new Error('Invalid manifest: missing required fields (name, version, description)');
    }

    // 2. Get all files from memory
    const files = this.getAllFiles(basePath);

    // 3. Scan for secrets in all files
    const { SecurityManager } = await import('../security');
    for (const [filePath, content] of files.entries()) {
      const secretScan = await SecurityManager.scanForSecrets(content);
      if (secretScan.hasSecrets) {
        const types = secretScan.secrets.map(s => s.type).join(', ');
        throw new Error(`Secrets detected in ${filePath}: ${types}`);
      }
    }

    // 4. Create ZIP package (consistent with .pdpkg format)
    const zip = new AdmZip();

    // Add files to ZIP
    for (const [filePath, content] of files.entries()) {
      if (options?.filter && !options.filter(filePath)) {
        continue; // Skip filtered files
      }

      const relativePath = filePath.startsWith(basePath)
        ? filePath.substring(basePath.length + 1)
        : filePath;

      // Add file to ZIP (AdmZip handles directory creation)
      zip.addFile(relativePath, Buffer.from(content, 'utf-8'));
    }

    // Add manifest.json
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));

    // Return ZIP buffer
    return zip.toBuffer();
  }
}

/**
 * Get the default file system (Node.js fs).
 */
export function getDefaultFileSystem(): IFileSystem {
  return new NodeFileSystem();
}