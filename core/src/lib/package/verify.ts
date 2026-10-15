// src/lib/package/verify.ts
/* openPdpkg: the ONE verified way to open a .pdpkg. Every install, extract and
 * compile-time package load goes through here; nothing returns package bytes
 * that were not checked against the package's own integrity record. Signature
 * verification is added HERE later, so every consumer picks it up by bumping core. */
import semver from 'semver';
import { readArchive } from './archive';
import { archiveDigest, sha256Hex } from './digest';
import { PackageVerificationError } from './errors';
import { parseManifest, type PackageIntegrity, type PackageManifest } from './manifest';
import { checkAgentPackage, type AgentRefs } from './agent';
import { ARCHIVE_COPY, META_FILE } from './layout';

export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
const MANIFEST_FILE = 'prompd.json';
const RESERVED_MANIFEST = 'manifest.json';
/** Files an install writes beside the package's own; a package holding one would be overwritten by, or overwrite, the install. */
const RESERVED_LAYOUT = new Set([ARCHIVE_COPY, META_FILE].map((n) => n.toLowerCase()));
const HEX_RE = /^[0-9a-f]{64}$/;

export interface OpenExpectations {
  /** Manifest name must equal this. */
  name?: string;
  /** Manifest version must satisfy this semver range (an exact version is a range). */
  range?: string;
  /** "sha256:<hex>" of the whole archive. */
  digest?: string;
}

export interface VerifiedPackage {
  manifest: PackageManifest & { integrity: PackageIntegrity };
  /** Raw prompd.json: the future signature digest input. */
  manifestBytes: Uint8Array;
  /** Every entry except prompd.json, raw bytes, posix paths. */
  files: Map<string, Uint8Array>;
  /** "sha256:<hex>" of the archive bytes. */
  digest: string;
  /** Present for type 'agent'. */
  agentRefs?: AgentRefs;
}

function integrityOf(raw: unknown): PackageIntegrity {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PackageVerificationError('INTEGRITY_MISSING', 'the package has no integrity block; republish it with "prompd package create"', MANIFEST_FILE);
  }
  const r = raw as Record<string, unknown>;
  if (r.algorithm !== 'sha256') {
    throw new PackageVerificationError('UNSUPPORTED_ALGORITHM', `integrity algorithm "${String(r.algorithm)}" is not supported (sha256 only)`, MANIFEST_FILE);
  }
  const files = r.files;
  if (typeof files !== 'object' || files === null || Array.isArray(files)) {
    throw new PackageVerificationError('INTEGRITY_MISSING', 'the integrity block lists no files', MANIFEST_FILE);
  }
  const out: Record<string, string> = {};
  for (const [p, h] of Object.entries(files as Record<string, unknown>)) {
    if (typeof h !== 'string' || !HEX_RE.test(h)) throw new PackageVerificationError('MANIFEST_INVALID', `the recorded hash for ${p} is not a sha256 hex digest`, MANIFEST_FILE);
    out[p] = h;
  }
  return { algorithm: 'sha256', files: out };
}

export async function openPdpkg(input: Uint8Array, expect: OpenExpectations = {}): Promise<VerifiedPackage> {
  if (input.length > MAX_PACKAGE_BYTES) {
    throw new PackageVerificationError('TOO_LARGE', `the package is ${input.length} bytes (max ${MAX_PACKAGE_BYTES})`);
  }
  // A private copy: the digest and the parsed entries must come from the same bytes,
  // even if the caller reuses its buffer while this is awaiting. Not input.slice():
  // on a Node Buffer that returns a view over the same memory.
  const bytes = new Uint8Array(input);
  const digest = await archiveDigest(bytes);
  if (expect.digest !== undefined && expect.digest !== digest) {
    throw new PackageVerificationError('DIGEST_MISMATCH', `the package is ${digest}, expected ${expect.digest}`);
  }

  const entries = await readArchive(bytes);
  for (const name of entries.keys()) {
    const folded = name.toLowerCase();
    if (folded === RESERVED_MANIFEST || (folded === MANIFEST_FILE && name !== MANIFEST_FILE)) {
      throw new PackageVerificationError('MANIFEST_RESERVED', `the package holds a root ${name}; the manifest is prompd.json only`, name);
    }
    if (RESERVED_LAYOUT.has(folded)) {
      throw new PackageVerificationError('MANIFEST_RESERVED', `the package holds a root ${name}, a name the install writes itself`, name);
    }
  }
  const manifestBytes = entries.get(MANIFEST_FILE);
  if (!manifestBytes) throw new PackageVerificationError('MANIFEST_MISSING', 'the package has no prompd.json', MANIFEST_FILE);

  const parsed = parseManifest(manifestBytes);
  const integrity = integrityOf(parsed.integrity);

  const files = new Map<string, Uint8Array>();
  for (const [p, b] of entries) if (p !== MANIFEST_FILE) files.set(p, b);
  for (const p of files.keys()) {
    if (!Object.prototype.hasOwnProperty.call(integrity.files, p)) {
      throw new PackageVerificationError('FILE_UNLISTED', `${p} is not listed in the integrity block`, p);
    }
  }
  for (const p of Object.keys(integrity.files)) {
    if (!files.has(p)) throw new PackageVerificationError('FILE_MISSING', `${p} is listed in the integrity block but not in the package`, p);
  }
  for (const [p, b] of files) {
    if ((await sha256Hex(b)) !== integrity.files[p]) {
      throw new PackageVerificationError('HASH_MISMATCH', `${p} does not match its recorded hash`, p);
    }
  }

  const manifest = { ...parsed, integrity };
  const agentRefs = manifest.type === 'agent' ? checkAgentPackage(manifest, files) : undefined;

  if (expect.name !== undefined && manifest.name !== expect.name) {
    throw new PackageVerificationError('NAME_MISMATCH', `asked for ${expect.name}, the package is ${manifest.name}`);
  }
  if (expect.range !== undefined && !semver.satisfies(manifest.version, expect.range)) {
    throw new PackageVerificationError('VERSION_MISMATCH', `asked for ${expect.range}, the package is ${manifest.version}`);
  }

  return { manifest, manifestBytes, files, digest, ...(agentRefs ? { agentRefs } : {}) };
}
