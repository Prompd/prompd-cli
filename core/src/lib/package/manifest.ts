import semver from 'semver';
import { isValidPackageType, type PackageType } from '../../types';
import { PackageVerificationError } from './errors';

/** Every registry package is scoped, and names are lower case only (a-z, 0-9, ".", "_", "-").
 * A scope or name made only of dots ('.', '..') is refused: it would resolve outside its package dir. */
export const PACKAGE_NAME_RE = /^@(?!\.+\/)[a-z0-9._-]+\/(?!\.+$)[a-z0-9._-]+$/;

export interface PackageIntegrity { algorithm: 'sha256'; files: Record<string, string> }
export interface PackageRequires { mcp?: string[]; skills?: string[] }

export interface PackageManifest {
  name: string;
  version: string;
  type: PackageType;
  description?: string;
  main?: string;
  dependencies?: Record<string, string>;
  requires?: PackageRequires;
  /** Validated by openPdpkg, not here: a manifest can be parsed before it is checked. */
  integrity?: unknown;
  [key: string]: unknown;
}

const decoder = new TextDecoder('utf-8', { fatal: true });
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function invalid(message: string): PackageVerificationError {
  return new PackageVerificationError('MANIFEST_INVALID', message, 'prompd.json');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringList(v: unknown, field: string): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string' || !s)) throw invalid(`${field} must be a list of names`);
  return v as string[];
}

export function unscopedName(name: string): string {
  const slash = name.indexOf('/');
  return name.startsWith('@') && slash > 0 ? name.slice(slash + 1) : name;
}

export function parseManifest(bytes: Uint8Array): PackageManifest {
  let text: string;
  try { text = decoder.decode(bytes); } catch { throw invalid('prompd.json is not UTF-8 text'); }
  let raw: unknown;
  try { raw = JSON.parse(text, (k, v: unknown) => (PROTO_KEYS.has(k) ? undefined : v)); }
  catch { throw invalid('prompd.json is not valid JSON'); }
  if (!isRecord(raw)) throw invalid('prompd.json is not a JSON object');

  const { name, version, type, dependencies, requires } = raw;
  if (typeof name !== 'string' || !PACKAGE_NAME_RE.test(name)) throw invalid('prompd.json "name" must be a scoped package name like @scope/name');
  if (typeof version !== 'string' || semver.valid(version) !== version) throw invalid('prompd.json "version" must be an exact semver version');

  let resolvedType: PackageType = 'package';
  if (type !== undefined) {
    if (typeof type !== 'string' || !isValidPackageType(type)) {
      throw new PackageVerificationError('TYPE_INVALID', `package type "${String(type)}" is not one of package, workflow, skill, agent`, 'prompd.json');
    }
    resolvedType = type;
  }

  let deps: Record<string, string> | undefined;
  if (dependencies !== undefined) {
    if (!isRecord(dependencies)) throw invalid('prompd.json "dependencies" must be an object');
    deps = {};
    for (const [dep, range] of Object.entries(dependencies)) {
      if (!PACKAGE_NAME_RE.test(dep)) throw invalid(`dependency "${dep}" is not a scoped package name`);
      if (typeof range !== 'string' || semver.validRange(range) === null) throw invalid(`dependency "${dep}" has an invalid version range`);
      deps[dep] = range;
    }
  }

  let req: PackageRequires | undefined;
  if (requires !== undefined) {
    if (!isRecord(requires)) throw invalid('prompd.json "requires" must be an object');
    const mcp = stringList(requires.mcp, 'requires.mcp');
    const skills = stringList(requires.skills, 'requires.skills');
    req = { ...(mcp ? { mcp } : {}), ...(skills ? { skills } : {}) };
  }

  return {
    ...raw,
    name,
    version,
    type: resolvedType,
    ...(deps ? { dependencies: deps } : {}),
    ...(req ? { requires: req } : {}),
  };
}
