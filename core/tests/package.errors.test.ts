import {
  PackageVerificationError, isPackageVerificationError, describeVerificationFailure,
} from '../src/lib/package/errors';
import { sha256Hex, archiveDigest, DIGEST_RE } from '../src/lib/package/digest';

describe('PackageVerificationError', () => {
  it('carries a code and an optional path', () => {
    const e = new PackageVerificationError('HASH_MISMATCH', 'a.md does not match its recorded hash', 'a.md');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('PackageVerificationError');
    expect(e.code).toBe('HASH_MISMATCH');
    expect(e.path).toBe('a.md');
  });

  it('is recognised by shape, not only by instanceof (dual cjs/esm builds)', () => {
    const plain = Object.assign(new Error('x'), { name: 'PackageVerificationError', code: 'FILE_MISSING' });
    expect(isPackageVerificationError(plain)).toBe(true);
    expect(isPackageVerificationError(new Error('x'))).toBe(false);
    expect(isPackageVerificationError(null)).toBe(false);
  });

  it('describes a failure as one line naming the ref', () => {
    const e = new PackageVerificationError('HASH_MISMATCH', 'skills/foo/SKILL.prmd does not match its recorded hash', 'skills/foo/SKILL.prmd');
    expect(describeVerificationFailure('@a/x@1.2.0', e))
      .toBe('@a/x@1.2.0 failed verification: skills/foo/SKILL.prmd does not match its recorded hash. Not installed.');
  });
});

describe('digests', () => {
  it('hashes bytes to lowercase hex', async () => {
    // sha256("abc")
    expect(await sha256Hex(new TextEncoder().encode('abc')))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('prefixes an archive digest', async () => {
    const d = await archiveDigest(new TextEncoder().encode('abc'));
    expect(d).toBe('sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(DIGEST_RE.test(d)).toBe(true);
  });
});
