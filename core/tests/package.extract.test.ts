import JSZip from 'jszip';
import { extractPdpkg, MemoryFileSystem } from '../src/lib/compiler/file-system';
import { MemoryPackageResolver } from '../src/lib/compiler/package-ref';
import { packPdpkg } from '../src/lib/package/pack';
import { archiveDigest } from '../src/lib/package/digest';
import { PackageVerificationError } from '../src/lib/package/errors';

async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return 'ok'; } catch (e) { return e instanceof PackageVerificationError ? e.code : `other: ${String(e)}`; }
}

describe('extractPdpkg (verified)', () => {
  it('returns text files and prompd.json from a verified package', async () => {
    const buf = await packPdpkg({ name: '@a/x', version: '1.0.0', type: 'package' }, new Map<string, string | Uint8Array>([['p/main.prmd', 'hi'], ['img.png', new Uint8Array([1, 2])]]));
    const files = await extractPdpkg(buf);
    expect(files.get('p/main.prmd')).toBe('hi');
    expect(JSON.parse(files.get('prompd.json') as string).name).toBe('@a/x');
    expect(files.has('img.png')).toBe(false);
  });

  it('refuses an old-style package (manifest.json, no integrity): the unverified path is gone', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ name: '@a/x', version: '1.0.0' }));
    zip.file('a.md', 'x');
    expect(await codeOf(extractPdpkg(await zip.generateAsync({ type: 'uint8array' })))).toBe('MANIFEST_RESERVED');
  });

  it('passes expectations through', async () => {
    const buf = await packPdpkg({ name: '@a/x', version: '1.0.0', type: 'package' }, new Map([['a.md', 'x']]));
    expect(await codeOf(extractPdpkg(buf, { name: '@b/y' }))).toBe('NAME_MISMATCH');
  });
});

describe('MemoryPackageResolver', () => {
  it('loads a verified package and applies a pin for name@version', async () => {
    const buf = await packPdpkg({ name: '@a/x', version: '1.0.0', type: 'package' }, new Map([['main.prmd', '---\nid: m\n---\nhi']]));
    const fs = new MemoryFileSystem();
    const ok = new MemoryPackageResolver(async () => buf, { pins: new Map([['@a/x@1.0.0', await archiveDigest(buf)]]) });
    const dir = await ok.resolvePackage('@a/x@1.0.0', { fileSystem: fs } as Parameters<MemoryPackageResolver['resolvePackage']>[1]);
    expect(await fs.exists(`${dir}/main.prmd`)).toBe(true);

    const bad = new MemoryPackageResolver(async () => buf, { pins: new Map([['@a/x@1.0.0', `sha256:${'0'.repeat(64)}`]]) });
    expect(await codeOf(bad.resolvePackage('@a/x@1.0.0', { fileSystem: new MemoryFileSystem() } as Parameters<MemoryPackageResolver['resolvePackage']>[1]))).toBe('DIGEST_MISMATCH');
  });
});
