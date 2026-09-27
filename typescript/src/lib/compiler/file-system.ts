/**
 * File System Abstraction (Node CLI).
 *
 * The interface and the pure in-memory base live in @prompd/core. This module
 * adds the Node-only pieces: NodeFileSystem (real fs) and a MemoryFileSystem
 * subclass that can ingest .pdpkg (ZIP) packages via adm-zip. Re-exported so
 * existing `./compiler/file-system` imports keep working unchanged.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import AdmZip from 'adm-zip';
import {
  IFileSystem,
  MemoryFileSystem as CoreMemoryFileSystem,
  parsePackageReference as parsePackageRef
} from '@prompd/core';

export type { IFileSystem } from '@prompd/core';

// CLI-only package ingestion limits. Module-level (not class statics) because
// core's MemoryFileSystem also declares private static MAX_PACKAGE_SIZE etc.,
// and TS2417 rejects a subclass redeclaring a base class's private static
// member under the same name.
const CLI_MAX_PACKAGE_SIZE = 50 * 1024 * 1024; // 50MB
const CLI_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const CLI_MAX_FILE_COUNT = 1000;

/**
 * Default file system implementation using Node.js fs.
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
 * In-memory file system with .pdpkg (ZIP) ingestion support.
 * Extends the pure core MemoryFileSystem with Node-only package operations.
 */
export class MemoryFileSystem extends CoreMemoryFileSystem {
  private validatePackageName(name: string): void {
    const pattern = /^@[a-z0-9.-]+\/[a-z0-9.-]+$/;
    if (!pattern.test(name)) {
      throw new Error(`Invalid package name: ${name}. Must match @namespace/package format.`);
    }
    if (name.includes('..') || name.includes('/./') || name.includes('//')) {
      throw new Error(`Security violation: Invalid characters in package name: ${name}`);
    }
  }

  private validateVersion(version: string): void {
    const semverPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
    if (!semverPattern.test(version)) {
      throw new Error(`Invalid version format: ${version}. Must be semantic version (e.g., 1.0.0)`);
    }
  }

  private validateZipStructure(zip: AdmZip): void {
    const entries = zip.getEntries();
    let fileCount = 0;
    let totalSize = 0;

    for (const entry of entries) {
      fileCount++;
      totalSize += entry.header.size;

      if (fileCount > CLI_MAX_FILE_COUNT) {
        throw new Error(`Package contains too many files (max: ${CLI_MAX_FILE_COUNT})`);
      }
      if (totalSize > CLI_MAX_PACKAGE_SIZE) {
        throw new Error(`Package too large (max: ${CLI_MAX_PACKAGE_SIZE} bytes)`);
      }
      this.validateZipEntry(entry);
    }
  }

  private validateZipEntry(entry: AdmZip.IZipEntry): void {
    const entryPath = entry.entryName;
    if (entryPath.includes('..') || entryPath.startsWith('/') || entryPath.startsWith('\\')) {
      throw new Error(`Security violation: Path traversal attempt (${entryPath})`);
    }
    if (path.isAbsolute(entryPath)) {
      throw new Error(`Security violation: Absolute path (${entryPath})`);
    }
    if (entry.header.size > CLI_MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${entryPath} (${entry.header.size} bytes, max: ${CLI_MAX_FILE_SIZE})`
      );
    }
    if (entryPath.includes('\0')) {
      throw new Error(`Security violation: Null byte in path (${entryPath})`);
    }
  }

  /**
   * Add a package from a ZIP Buffer to the in-memory file system.
   */
  async addPackage(packageName: string, version: string, packageBuffer: Buffer): Promise<void> {
    this.validatePackageName(packageName);
    this.validateVersion(version);

    if (packageBuffer.length > CLI_MAX_PACKAGE_SIZE) {
      throw new Error(
        `Package too large: ${packageBuffer.length} bytes (max: ${CLI_MAX_PACKAGE_SIZE})`
      );
    }

    const zip = new AdmZip(packageBuffer);
    this.validateZipStructure(zip);

    const packagePath = this.getPackagePath(packageName, version);
    const entries = zip.getEntries();

    const normalizedPackagePath = this.normalizePath(packagePath);
    const packagePrefix = normalizedPackagePath.endsWith('/')
      ? normalizedPackagePath
      : normalizedPackagePath + '/';

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const content = entry.getData().toString('utf8');
      const entryPath = entry.entryName;
      const filePath = this.join(packagePath, entryPath);

      const normalizedFilePath = this.normalizePath(filePath);
      if (!normalizedFilePath.startsWith(packagePrefix) && normalizedFilePath !== normalizedPackagePath) {
        throw new Error(`Security violation: extracted path escapes package directory: ${entryPath}`);
      }

      this.addFile(filePath, content);
    }
  }

  private async loadDirectoryToMemory(sourceDir: string, targetPath: string): Promise<void> {
    const entries = await fs.readdir(sourceDir);
    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry);
      const stat = await fs.stat(sourcePath);
      if (stat.isDirectory()) {
        await this.loadDirectoryToMemory(sourcePath, this.join(targetPath, entry));
      } else if (stat.isFile()) {
        const content = await fs.readFile(sourcePath, 'utf-8');
        this.addFile(this.join(targetPath, entry), content);
      }
    }
  }

  /**
   * Add a package from the registry to the in-memory file system.
   */
  async addPackageFromRegistry(
    packageRef: string,
    downloadFn?: (packageName: string, version: string) => Promise<{ tarball: Buffer; metadata: any }>
  ): Promise<void> {
    const { name, version } = parsePackageRef(packageRef);

    if (!downloadFn) {
      throw new Error('downloadFn is required to fetch packages from registry. Pass RegistryClient.downloadPackageBuffer');
    }

    const packageData = await downloadFn(name, version);
    await this.addPackage(name, version, packageData.tarball);
  }

  /**
   * Create a .pdpkg (ZIP) Buffer from in-memory files. Scans for secrets first.
   */
  async createPackageBuffer(
    basePath: string,
    manifest: Record<string, any>,
    options?: { filter?: (path: string) => boolean }
  ): Promise<Buffer> {
    if (!manifest.name || !manifest.version || !manifest.description) {
      throw new Error('Invalid manifest: missing required fields (name, version, description)');
    }

    const files = this.getAllFiles(basePath);

    const { SecurityManager } = await import('../security');
    for (const [filePath, content] of files.entries()) {
      const secretScan = await SecurityManager.scanForSecrets(content);
      if (secretScan.hasSecrets) {
        const types = secretScan.secrets.map((s: { type: string }) => s.type).join(', ');
        throw new Error(`Secrets detected in ${filePath}: ${types}`);
      }
    }

    const zip = new AdmZip();
    for (const [filePath, content] of files.entries()) {
      if (options?.filter && !options.filter(filePath)) continue;
      const relativePath = filePath.startsWith(basePath)
        ? filePath.substring(basePath.length + 1)
        : filePath;
      zip.addFile(relativePath, Buffer.from(content, 'utf-8'));
    }
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));

    return zip.toBuffer();
  }
}

/**
 * Get the default file system (Node.js fs).
 */
export function getDefaultFileSystem(): IFileSystem {
  return new NodeFileSystem();
}
