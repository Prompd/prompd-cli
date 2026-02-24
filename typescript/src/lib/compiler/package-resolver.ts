/**
 * Package Resolution Utilities
 *
 * Handles resolution of package references to local file paths,
 * including registry discovery via /.well-known/registry.json
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';
import { RegistryClient } from '../registry';
import { SecurityError } from '../errors';
import { IFileSystem, MemoryFileSystem } from './file-system';
import { PACKAGE_TYPE_DIRS } from '../../types';

/**
 * Options for package resolution.
 */
export interface ResolvePackageOptions {
  /** File system to use (for in-memory package resolution) */
  fileSystem?: IFileSystem;
  /** Registry URL for downloading packages */
  registryUrl?: string;
  /** Workspace root directory for local package cache */
  workspaceRoot?: string;
}

/**
 * Resolve a package reference to a local file path or in-memory path.
 *
 * @param packageRef - Package reference in format: @namespace/package@version
 * @param fileSystemOrOptions - Optional file system or options object
 * @param registryUrl - Optional registry URL (deprecated, use options object)
 * @returns Resolved local path to the package directory (or virtual path for MemoryFileSystem)
 */
export async function resolvePackage(
  packageRef: string,
  fileSystemOrOptions?: IFileSystem | ResolvePackageOptions,
  registryUrl?: string
): Promise<string> {
  // Handle both legacy (fileSystem, registryUrl) and new (options) signatures
  let fileSystem: IFileSystem | undefined;
  let resolvedRegistryUrl: string | undefined;
  let workspaceRoot: string | undefined;

  if (fileSystemOrOptions && 'exists' in fileSystemOrOptions) {
    // Legacy: fileSystem passed directly
    fileSystem = fileSystemOrOptions;
    resolvedRegistryUrl = registryUrl;
  } else if (fileSystemOrOptions) {
    // New: options object
    const opts = fileSystemOrOptions as ResolvePackageOptions;
    fileSystem = opts.fileSystem;
    resolvedRegistryUrl = opts.registryUrl;
    workspaceRoot = opts.workspaceRoot;
  }

  // Security: Validate package reference format
  if (!isValidPackageReference(packageRef)) {
    throw new SecurityError(`Invalid package reference format: ${packageRef}`);
  }

  // Parse package reference
  const { name, version } = parsePackageReference(packageRef);

  // Handle in-memory file system
  if (fileSystem instanceof MemoryFileSystem) {
    const packagePath = fileSystem.getPackagePath(name, version);

    // Check if package already loaded in memory
    if (fileSystem.exists(packagePath)) {
      return packagePath;
    }

    // Package not in memory - download and add it
    try {
      // Create registry client with optional URL override
      const registry = new RegistryClient(resolvedRegistryUrl ? { registryUrl: resolvedRegistryUrl } : undefined);

      // Create download function for MemoryFileSystem
      const downloadFn = async (pkgName: string, pkgVersion: string) => {
        return await registry.downloadPackageBuffer(pkgName, pkgVersion);
      };

      await fileSystem.addPackageFromRegistry(packageRef, downloadFn);
      return packagePath;
    } catch (error) {
      throw new Error(`Failed to load package into memory ${packageRef}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Default: disk-based resolution
  // Resolution order:
  // 1. Check local type directories (.prompd/packages/, .prompd/workflows/, etc.)
  // 2. Check global type directories (~/.prompd/packages/, ~/.prompd/workflows/, etc.)
  // 3. Check legacy cache dirs (.prompd/cache/) for backward compatibility
  // 4. Download from registry

  const localBase = getLocalBaseDir(workspaceRoot);
  const globalBase = getGlobalBaseDir();
  const typeDirs = Object.values(PACKAGE_TYPE_DIRS);

  // Check all type directories locally first
  for (const typeDir of typeDirs) {
    const dir = path.join(localBase, typeDir, name, version);
    if (await fs.pathExists(dir)) {
      return dir;
    }
  }

  // Check all type directories globally
  for (const typeDir of typeDirs) {
    const dir = path.join(globalBase, typeDir, name, version);
    if (await fs.pathExists(dir)) {
      return dir;
    }
  }

  // Legacy: check old flat cache directories
  const localCacheDir = getLocalCacheDir(workspaceRoot);
  const globalCacheDir = getGlobalCacheDir();

  const localPackageDir = path.join(localCacheDir, name, version);
  if (await fs.pathExists(localPackageDir)) {
    return localPackageDir;
  }
  const localPackageDirLegacy = path.join(localCacheDir, `${name}@${version}`);
  if (await fs.pathExists(localPackageDirLegacy)) {
    return localPackageDirLegacy;
  }
  const globalPackageDir = path.join(globalCacheDir, name, version);
  if (await fs.pathExists(globalPackageDir)) {
    return globalPackageDir;
  }
  const globalPackageDirLegacy = path.join(globalCacheDir, `${name}@${version}`);
  if (await fs.pathExists(globalPackageDirLegacy)) {
    return globalPackageDirLegacy;
  }

  // Package not cached - try to install it
  try {
    // Create registry client with optional URL override
    const registry = new RegistryClient(resolvedRegistryUrl ? { registryUrl: resolvedRegistryUrl } : undefined);
    await registry.install(packageRef, { skipCache: false, workspaceRoot });

    // After installation, check type directories again (new install location)
    for (const typeDir of typeDirs) {
      const localDir = path.join(localBase, typeDir, name, version);
      if (await fs.pathExists(localDir)) {
        return localDir;
      }
      const globalDir = path.join(globalBase, typeDir, name, version);
      if (await fs.pathExists(globalDir)) {
        return globalDir;
      }
    }

    throw new Error(`Package installation succeeded but package not found: ${packageRef}`);
  } catch (error) {
    throw new Error(`Failed to resolve package ${packageRef}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Parse package reference into name and version.
 */
export function parsePackageReference(packageRef: string): { name: string; version: string; scope?: string } {
  // Format: @namespace/package@version or @namespace/package (latest)
  const match = packageRef.match(/^(@[\w.-]+\/[\w.-]+)@?([\w.-]+)?$/);

  if (!match) {
    throw new Error(`Invalid package reference format: ${packageRef}`);
  }

  const name = match[1];
  const version = match[2] || 'latest';

  // Extract scope
  const scopeMatch = name.match(/^(@[\w.-]+)\//);
  const scope = scopeMatch ? scopeMatch[1] : undefined;

  return { name, version, scope };
}

/**
 * Validate package reference format.
 */
export function isValidPackageReference(packageRef: string): boolean {
  // Security: Ensure package ref follows npm-style scoped package format
  // Format: @namespace/package@version
  const pattern = /^@[\w.-]+\/[\w.-]+(@[\w.-]+)?$/;

  if (!pattern.test(packageRef)) {
    return false;
  }

  // Security: Check for path traversal attempts
  if (packageRef.includes('..') || packageRef.includes('//')) {
    return false;
  }

  // Security: Check for null bytes
  if (packageRef.includes('\0')) {
    return false;
  }

  return true;
}

/**
 * Get the global .prompd base directory (~/.prompd/).
 */
export function getGlobalBaseDir(): string {
  return path.join(os.homedir(), '.prompd');
}

/**
 * Get the local project .prompd base directory (./.prompd/).
 * @param workspaceRoot - Optional workspace root directory. If not provided, uses process.cwd()
 */
export function getLocalBaseDir(workspaceRoot?: string): string {
  const basePath = workspaceRoot || process.cwd();
  return path.join(basePath, '.prompd');
}

/**
 * Get the global package cache directory (~/.prompd/cache/).
 * @deprecated Legacy path. New installs use type-specific dirs (packages/, workflows/, etc.)
 */
export function getGlobalCacheDir(): string {
  return path.join(os.homedir(), '.prompd', 'cache');
}

/**
 * Get the local project package cache directory (./.prompd/cache/).
 * @deprecated Legacy path. New installs use type-specific dirs (packages/, workflows/, etc.)
 * @param workspaceRoot - Optional workspace root directory. If not provided, uses process.cwd()
 */
export function getLocalCacheDir(workspaceRoot?: string): string {
  const basePath = workspaceRoot || process.cwd();
  return path.join(basePath, '.prompd', 'cache');
}

/**
 * Get the package cache directory (for backward compatibility).
 * @deprecated Use getGlobalBaseDir() or getLocalBaseDir() instead
 */
export function getPackageCacheDir(): string {
  return getGlobalCacheDir();
}

/**
 * Resolve a file path within a package.
 *
 * @param packagePath - Base path to package directory
 * @param filePath - Relative file path within package
 * @returns Resolved absolute path
 */
export function resolvePackageFile(packagePath: string, filePath: string): string {
  // Security: Path traversal protection
  const normalized = path.normalize(filePath);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new SecurityError(`Invalid file path within package: ${filePath}`);
  }

  const resolvedPath = path.join(packagePath, normalized);

  // Security: Ensure resolved path is within package directory
  // Normalize both to forward slashes for cross-platform comparison
  // (MemoryFileSystem uses POSIX paths, but path.join uses OS-native separators)
  const resolvedNorm = resolvedPath.replace(/\\/g, '/');
  const packageNorm = packagePath.replace(/\\/g, '/');
  if (!resolvedNorm.startsWith(packageNorm)) {
    throw new SecurityError(`Path traversal detected: ${filePath}`);
  }

  return resolvedPath;
}

/**
 * Check if a package is installed (in any type directory, local or global).
 * @param packageRef - Package reference to check
 * @param workspaceRoot - Optional workspace root directory for local cache
 */
export async function isPackageInstalled(packageRef: string, workspaceRoot?: string): Promise<boolean> {
  try {
    const { name, version } = parsePackageReference(packageRef);
    const localBase = getLocalBaseDir(workspaceRoot);
    const globalBase = getGlobalBaseDir();
    const typeDirs = Object.values(PACKAGE_TYPE_DIRS);

    // Check all type directories locally
    for (const typeDir of typeDirs) {
      if (await fs.pathExists(path.join(localBase, typeDir, name, version))) {
        return true;
      }
    }

    // Check all type directories globally
    for (const typeDir of typeDirs) {
      if (await fs.pathExists(path.join(globalBase, typeDir, name, version))) {
        return true;
      }
    }

    // Legacy: check flat cache directories
    if (await fs.pathExists(path.join(getLocalCacheDir(workspaceRoot), name, version))) {
      return true;
    }
    if (await fs.pathExists(path.join(getGlobalCacheDir(), name, version))) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
