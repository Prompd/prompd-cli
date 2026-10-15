import { verifyInstalled } from '../src/lib/package/installed';
import { installPackage, type PackageStore } from '../src/lib/compiler/install';
import { packPdpkg } from '../src/lib/package/pack';
import { PackageVerificationError } from '../src/lib/package/errors';

async function installed() {
  const buf = await packPdpkg({ name: '@a/s', version: '1.0.0', type: 'skill' }, new Map([['SKILL.md', '# skill'], ['scripts/run.js', 'x()']]));
  const bytes = new Map<string, Uint8Array>();
  const store: PackageStore = {
    writeFile(p, c) { bytes.set(p, new TextEncoder().encode(c)); },
    writeBytes(p, b) { bytes.set(p, b); },
    removeDir() { /* fresh store */ },
  };
  const res = await installPackage({ ref: '@a/s@1.0.0', root: '', installDir: '', store, download: async () => buf });
  const read = async (rel: string) => bytes.get(`${res.installedPath}/${rel}`) ?? null;
  return { res, bytes, read };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return 'ok'; } catch (e) { return e instanceof PackageVerificationError ? `${e.code}:${e.path ?? ''}` : `other: ${String(e)}`; }
}

describe('verifyInstalled', () => {
  it('returns the verified package for an untouched install', async () => {
    const { res, read } = await installed();
    const pkg = await verifyInstalled(read, res.digest);
    expect(pkg.manifest.name).toBe('@a/s');
    expect(new TextDecoder().decode(pkg.files.get('SKILL.md'))).toBe('# skill');
  });

  it('refuses an edited file', async () => {
    const { res, bytes, read } = await installed();
    bytes.set(`${res.installedPath}/SKILL.md`, new TextEncoder().encode('# evil'));
    expect(await codeOf(verifyInstalled(read, res.digest))).toBe('HASH_MISMATCH:SKILL.md');
  });

  it('refuses a deleted file', async () => {
    const { res, bytes, read } = await installed();
    bytes.delete(`${res.installedPath}/scripts/run.js`);
    expect(await codeOf(verifyInstalled(read, res.digest))).toBe('FILE_MISSING:scripts/run.js');
  });

  it('refuses when the archive copy is gone or swapped, even if .prmdmeta is edited to match', async () => {
    const { res, bytes, read } = await installed();
    const other = await packPdpkg({ name: '@a/s', version: '1.0.0', type: 'skill' }, new Map([['SKILL.md', '# evil'], ['scripts/run.js', 'x()']]));
    bytes.set(`${res.installedPath}/.package.pdpkg`, other);
    bytes.set(`${res.installedPath}/SKILL.md`, new TextEncoder().encode('# evil'));
    expect(await codeOf(verifyInstalled(read, res.digest))).toBe('DIGEST_MISMATCH:');
    bytes.delete(`${res.installedPath}/.package.pdpkg`);
    expect(await codeOf(verifyInstalled(read, res.digest))).toBe('FILE_MISSING:.package.pdpkg');
  });
});
