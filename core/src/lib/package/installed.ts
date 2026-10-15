/* Re-verify an installed package on load. A digest written beside the files
 * would prove nothing (edit a file, edit its hash), so the check is against the
 * exact archive the install stored: hash it against the digest the caller
 * trusts (a lockfile pin or a PACKAGE.json name entry), open it, and require
 * every extracted file to be byte-identical to the archive's entry. Callers read
 * definition files from the returned verified bytes. */
import { PackageVerificationError } from './errors';
import { ARCHIVE_COPY } from './layout';
import { openPdpkg, type VerifiedPackage } from './verify';

export type InstalledReader = (relPath: string) => Promise<Uint8Array | null>;

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function verifyInstalled(
  read: InstalledReader,
  expectedDigest: string,
  expect: { name?: string; range?: string } = {},
): Promise<VerifiedPackage> {
  const archive = await read(ARCHIVE_COPY);
  if (!archive) {
    throw new PackageVerificationError('FILE_MISSING', `${ARCHIVE_COPY} is missing, so this install cannot be verified; reinstall the package`, ARCHIVE_COPY);
  }
  const pkg = await openPdpkg(archive, { ...expect, digest: expectedDigest });
  for (const [p, b] of pkg.files) {
    const onDisk = await read(p);
    if (!onDisk) throw new PackageVerificationError('FILE_MISSING', `${p} is missing from the installed package`, p);
    if (!same(onDisk, b)) throw new PackageVerificationError('HASH_MISMATCH', `${p} does not match its recorded hash`, p);
  }
  return pkg;
}
