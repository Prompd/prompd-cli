/** Why a package was refused. Every verification failure in core is one of these,
 * so hosts can map a code to their own words without parsing messages. */
export type PackageVerificationCode =
  | 'ARCHIVE_INVALID' | 'UNSAFE_PATH' | 'TOO_LARGE'
  | 'MANIFEST_MISSING' | 'MANIFEST_RESERVED' | 'MANIFEST_INVALID' | 'TYPE_INVALID'
  | 'INTEGRITY_MISSING' | 'UNSUPPORTED_ALGORITHM'
  | 'FILE_UNLISTED' | 'FILE_MISSING' | 'HASH_MISMATCH'
  | 'NAME_MISMATCH' | 'VERSION_MISMATCH' | 'DIGEST_MISMATCH';

export class PackageVerificationError extends Error {
  readonly code: PackageVerificationCode;
  readonly path?: string;

  constructor(code: PackageVerificationCode, message: string, path?: string) {
    super(message);
    this.name = 'PackageVerificationError';
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}

/** Shape check rather than instanceof: core ships both cjs and esm builds, and a
 * host can end up with two copies of the class. */
export function isPackageVerificationError(e: unknown): e is PackageVerificationError {
  if (!(e instanceof Error)) return false;
  const code = (e as { code?: unknown }).code;
  return e.name === 'PackageVerificationError' && typeof code === 'string';
}

/** The one line every host shows for a refused install. */
export function describeVerificationFailure(ref: string, e: PackageVerificationError): string {
  return `${ref} failed verification: ${e.message}. Not installed.`;
}
