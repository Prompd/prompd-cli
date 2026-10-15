/**
 * File System Abstraction (Node CLI).
 *
 * The interface and the pure in-memory base live in @prompd/core. This module
 * adds the Node-only pieces: NodeFileSystem (real fs) and a MemoryFileSystem
 * subclass that adds name/size guards and a packPdpkg-backed createPackageBuffer. Re-exported so
 * existing `./compiler/file-system` imports keep working unchanged.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import {
  IFileSystem,
  MemoryFileSystem as CoreMemoryFileSystem,
  parsePackageReference as parsePackageRef,
  packPdpkg,
  type PackageType
} from '@prompd/core';

export type { IFileSystem } from '@prompd/core';

// CLI-only cap on the archive size, checked before core opens it. Module-level
// (not a class static) because core's MemoryFileSystem declares private statics
// of its own, and TS2417 rejects a subclass redeclaring one under the same name.
const CLI_MAX_PACKAGE_SIZE = 50 * 1024 * 1024; // 50MB

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

    // Verification, extraction and path-escape checks are core's single ingest path.
    await super.addPackage(packageName, version, new Uint8Array(packageBuffer));
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
    downloadFn?: (packageName: string, version: string) => Promise<{ tarball: Buffer; metadata: unknown }>
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
    manifest: Record<string, unknown>,
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

    const base = this.normalizePath(basePath);
    const packed = new Map<string, string>();
    for (const [filePath, content] of files.entries()) {
      if (options?.filter && !options.filter(filePath)) continue;
      const rel = filePath.startsWith(base + '/') ? filePath.substring(base.length + 1) : filePath;
      if (rel === 'prompd.json' || rel === 'manifest.json') continue;
      packed.set(rel, content);
    }
    const bytes = await packPdpkg(
      {
        ...manifest,
        name: String(manifest.name),
        version: String(manifest.version),
        type: (manifest.type ?? 'package') as PackageType,
      },
      packed
    );
    return Buffer.from(bytes);
  }
}

/**
 * Get the default file system (Node.js fs).
 */
export function getDefaultFileSystem(): IFileSystem {
  return new NodeFileSystem();
}
