/**
 * Pure package-reference helpers.
 *
 * These are the parts of the CLI's package-resolver that are environment-agnostic
 * (string parsing + path-safety checks). The Node-only disk/registry resolution
 * (`resolvePackage`, base-dir lookups) lives in @prompd/cli and is injected via
 * IPackageResolver. Path operations are inlined as POSIX so this stays node-free.
 */

import semver from 'semver';
import { SecurityError } from '../errors';

/** POSIX path normalize (collapse ./ and ../, no fs). */
function posixNormalize(p: string): string {
  const isAbs = p.startsWith('/');
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!isAbs) out.push('..');
    } else {
      out.push(part);
    }
  }
  const joined = out.join('/');
  return isAbs ? '/' + joined : (joined || '.');
}

function posixIsAbsolute(p: string): boolean {
  return p.startsWith('/');
}

/**
 * Strip a file path suffix from a package reference.
 * @example "@ns/pkg@1.0.0/prompts/file.prmd" -> "@ns/pkg@1.0.0"
 */
export function stripFilePath(packageRef: string): string {
  const match = packageRef.match(/^(@[\w.-]+\/[\w.-]+(?:@[\w.-]+)?)/);
  return match ? match[1] : packageRef;
}

/**
 * Parse package reference into name and version. Strips any file path suffix.
 */
export function parsePackageReference(packageRef: string): { name: string; version: string; scope?: string } {
  const stripped = stripFilePath(packageRef);
  const match = stripped.match(/^(@[\w.-]+\/[\w.-]+)@?([\w.-]+)?$/);

  if (!match) {
    throw new Error(`Invalid package reference format: ${packageRef}`);
  }

  const name = match[1];
  const rawVersion = match[2] || 'latest';
  const version = semver.valid(rawVersion) || rawVersion;

  const scopeMatch = name.match(/^(@[\w.-]+)\//);
  const scope = scopeMatch ? scopeMatch[1] : undefined;

  return { name, version, scope };
}

/**
 * Parse a package reference that may include a file path within the package.
 * Format: @namespace/package@version/path/to/file.prmd
 */
export function parsePackageReferenceWithPath(packageRef: string): { name: string; version: string; scope?: string; filePath?: string } {
  const { name, version, scope } = parsePackageReference(packageRef);
  const stripped = stripFilePath(packageRef);
  const remainder = packageRef.slice(stripped.length);
  const filePath = remainder.length > 1 ? remainder.slice(1) : undefined;
  return { name, version, scope, filePath };
}

/**
 * Validate package reference format. Accepts optional file path suffix.
 */
export function isValidPackageReference(packageRef: string): boolean {
  if (packageRef.includes('\0')) {
    return false;
  }

  const base = stripFilePath(packageRef);

  const pattern = /^@[\w.-]+\/[\w.-]+(@[\w.-]+)?$/;
  if (!pattern.test(base)) {
    return false;
  }

  const remainder = packageRef.slice(base.length);
  if (remainder.length > 0) {
    if (!remainder.startsWith('/')) {
      return false;
    }
    const filePath = remainder.slice(1);
    if (filePath.includes('..') || filePath.includes('//')) {
      return false;
    }
    if (!/^[\w./\-]+$/.test(filePath)) {
      return false;
    }
  }

  if (base.includes('..') || base.includes('//')) {
    return false;
  }

  return true;
}

/**
 * Resolve a file path within a package (POSIX, path-traversal safe).
 */
export function resolvePackageFile(packagePath: string, filePath: string): string {
  const normalized = posixNormalize(filePath.replace(/\\/g, '/'));
  if (normalized.startsWith('..') || posixIsAbsolute(normalized)) {
    throw new SecurityError(`Invalid file path within package: ${filePath}`);
  }

  const packageNorm = packagePath.replace(/\\/g, '/');
  const resolvedPath = posixNormalize(`${packageNorm}/${normalized}`);

  if (!resolvedPath.startsWith(packageNorm.replace(/\/$/, ''))) {
    throw new SecurityError(`Path traversal detected: ${filePath}`);
  }

  return resolvedPath;
}
