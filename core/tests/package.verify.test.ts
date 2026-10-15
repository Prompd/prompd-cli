// tests/package.verify.test.ts
import JSZip from 'jszip';
import { openPdpkg } from '../src/lib/package/verify';
import { packPdpkg, computeIntegrity } from '../src/lib/package/pack';
import { PackageVerificationError } from '../src/lib/package/errors';
import { archiveDigest } from '../src/lib/package/digest';

const t = (s: string) => new TextEncoder().encode(s);

async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return 'ok'; } catch (e) { return e instanceof PackageVerificationError ? e.code : `other: ${String(e)}`; }
}

/** A zip built by hand, so a test can make it wrong in exactly one way. */
async function rawZip(entries: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [k, v] of Object.entries(entries)) zip.file(k, v);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

async function manifestWith(files: Record<string, string>, over: Record<string, unknown> = {}): Promise<string> {
  const integ = await computeIntegrity(new Map(Object.entries(files).map(([k, v]) => [k, t(v)])));
  return JSON.stringify({ name: '@a/x', version: '1.2.0', integrity: integ, ...over });
}

describe('packPdpkg + openPdpkg round trip', () => {
  it('returns the exact bytes packed, binary included, and a digest of the archive', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const bytes = await packPdpkg({ name: '@a/x', version: '1.2.0', type: 'package' }, new Map<string, Uint8Array | string>([['a.md', 'hello'], ['img/x.png', png]]));
    const pkg = await openPdpkg(bytes);
    expect(pkg.manifest.name).toBe('@a/x');
    expect(pkg.manifest.integrity.algorithm).toBe('sha256');
    expect(new TextDecoder().decode(pkg.files.get('a.md'))).toBe('hello');
    expect(pkg.files.get('img/x.png')).toEqual(png);
    expect(pkg.files.has('prompd.json')).toBe(false);
    expect(pkg.digest).toBe(await archiveDigest(bytes));
  });

  it('refuses to pack a reserved or unsafe name', async () => {
    await expect(packPdpkg({ name: '@a/x', version: '1.0.0', type: 'package' }, new Map([['prompd.json', '{}']]))).rejects.toThrow(/reserved/);
    await expect(packPdpkg({ name: '@a/x', version: '1.0.0', type: 'package' }, new Map([['../x.md', 'x']]))).rejects.toThrow();
  });

  it('refuses root names that would poison an object map', async () => {
    for (const p of ['__proto__', 'constructor', 'prototype']) {
      await expect(packPdpkg({ name: '@a/x', version: '1.0.0', type: 'package' }, new Map([[p, 'x']]))).rejects.toThrow(
        'Refusing package path "' + p + '": it is a reserved name',
      );
    }
  });

  it('refuses the install layout names, in any casing', async () => {
    for (const p of ['.package.pdpkg', '.PACKAGE.PDPKG', '.prmdmeta', '.PrmdMeta']) {
      await expect(packPdpkg({ name: '@a/x', version: '1.0.0', type: 'package' }, new Map([[p, 'x']]))).rejects.toThrow('reserved');
    }
  });

  it('refuses a differently cased manifest name', async () => {
    for (const p of ['Manifest.json', 'PROMPD.JSON', 'Prompd.json']) {
      await expect(packPdpkg({ name: '@a/x', version: '1.0.0', type: 'package' }, new Map([[p, '{}']]))).rejects.toThrow('reserved for the manifest');
    }
  });
});

describe('openPdpkg refusals', () => {
  it('INTEGRITY_MISSING without an integrity block', async () => {
    const z = await rawZip({ 'prompd.json': JSON.stringify({ name: '@a/x', version: '1.0.0' }), 'a.md': 'x' });
    expect(await codeOf(openPdpkg(z))).toBe('INTEGRITY_MISSING');
  });

  it('UNSUPPORTED_ALGORITHM for anything but sha256', async () => {
    const z = await rawZip({ 'prompd.json': JSON.stringify({ name: '@a/x', version: '1.0.0', integrity: { algorithm: 'md5', files: {} } }) });
    expect(await codeOf(openPdpkg(z))).toBe('UNSUPPORTED_ALGORITHM');
  });

  it('MANIFEST_MISSING without prompd.json', async () => {
    expect(await codeOf(openPdpkg(await rawZip({ 'a.md': 'x' })))).toBe('MANIFEST_MISSING');
  });

  it('MANIFEST_RESERVED with a root manifest.json', async () => {
    const files = { 'a.md': 'x' };
    const z = await rawZip({ 'prompd.json': await manifestWith(files), 'manifest.json': '{}', ...files });
    expect(await codeOf(openPdpkg(z))).toBe('MANIFEST_RESERVED');
  });

  it('MANIFEST_RESERVED for another casing of manifest.json', async () => {
    for (const name of ['Manifest.json', 'MANIFEST.JSON']) {
      const files = { 'a.md': 'x', [name]: '{}' };
      const z = await rawZip({ 'prompd.json': await manifestWith(files), ...files });
      expect(await codeOf(openPdpkg(z))).toBe('MANIFEST_RESERVED');
    }
  });

  it('MANIFEST_RESERVED when the manifest is not exactly lowercase prompd.json', async () => {
    for (const name of ['PROMPD.JSON', 'Prompd.json']) {
      const z = await rawZip({ [name]: await manifestWith({ 'a.md': 'x' }), 'a.md': 'x' });
      expect(await codeOf(openPdpkg(z))).toBe('MANIFEST_RESERVED');
    }
  });

  it('still reads exact lowercase prompd.json as the manifest', async () => {
    const files = { 'a.md': 'x' };
    const z = await rawZip({ 'prompd.json': await manifestWith(files), ...files });
    expect(await codeOf(openPdpkg(z))).toBe('ok');
  });

  it('MANIFEST_RESERVED for a root install layout file, in any casing', async () => {
    for (const name of ['.package.pdpkg', '.Package.Pdpkg', '.prmdmeta', '.PRMDMETA']) {
      const files = { 'a.md': 'x', [name]: 'x' };
      const z = await rawZip({ 'prompd.json': await manifestWith(files), ...files });
      expect(await codeOf(openPdpkg(z))).toBe('MANIFEST_RESERVED');
    }
  });

  it('verifies a private copy, so the caller changing its buffer mid-open changes nothing', async () => {
    const bytes = await packPdpkg({ name: '@a/x', version: '1.2.0', type: 'package' }, new Map([['a.md', 'hello']]));
    const digest = await archiveDigest(bytes);
    const opening = openPdpkg(bytes);
    bytes.fill(0);
    const pkg = await opening;
    expect(pkg.digest).toBe(digest);
    expect(new TextDecoder().decode(pkg.files.get('a.md'))).toBe('hello');
  });

  it('copies a Node Buffer too (Buffer.prototype.slice shares memory)', async () => {
    const bytes = await packPdpkg({ name: '@a/x', version: '1.2.0', type: 'package' }, new Map([['a.md', 'hello']]));
    const digest = await archiveDigest(bytes);
    const buf = Buffer.from(bytes);
    const opening = openPdpkg(buf);
    buf.fill(0);
    const pkg = await opening;
    expect(pkg.digest).toBe(digest);
    expect(new TextDecoder().decode(pkg.files.get('a.md'))).toBe('hello');
  });

  it('FILE_UNLISTED for a file the integrity block does not list', async () => {
    const z = await rawZip({ 'prompd.json': await manifestWith({ 'a.md': 'x' }), 'a.md': 'x', 'extra.md': 'y' });
    expect(await codeOf(openPdpkg(z))).toBe('FILE_UNLISTED');
  });

  it('FILE_MISSING for a listed file that is absent', async () => {
    const z = await rawZip({ 'prompd.json': await manifestWith({ 'a.md': 'x', 'b.md': 'y' }), 'a.md': 'x' });
    expect(await codeOf(openPdpkg(z))).toBe('FILE_MISSING');
  });

  it('HASH_MISMATCH for a tampered byte', async () => {
    const z = await rawZip({ 'prompd.json': await manifestWith({ 'a.md': 'x' }), 'a.md': 'X' });
    expect(await codeOf(openPdpkg(z))).toBe('HASH_MISMATCH');
  });

  it('NAME_MISMATCH, VERSION_MISMATCH and DIGEST_MISMATCH against expectations', async () => {
    const bytes = await packPdpkg({ name: '@a/x', version: '1.2.0', type: 'package' }, new Map([['a.md', 'x']]));
    expect(await codeOf(openPdpkg(bytes, { name: '@b/y' }))).toBe('NAME_MISMATCH');
    expect(await codeOf(openPdpkg(bytes, { range: '^2.0.0' }))).toBe('VERSION_MISMATCH');
    expect(await codeOf(openPdpkg(bytes, { digest: `sha256:${'0'.repeat(64)}` }))).toBe('DIGEST_MISMATCH');
    expect(await codeOf(openPdpkg(bytes, { name: '@a/x', range: '^1.0.0', digest: await archiveDigest(bytes) }))).toBe('ok');
  });

  it('TOO_LARGE past the package size cap, before reading the zip', async () => {
    expect(await codeOf(openPdpkg(new Uint8Array(50 * 1024 * 1024 + 1)))).toBe('TOO_LARGE');
  });

  it('runs the agent rule for agent packages', async () => {
    const files = new Map<string, Uint8Array | string>([
      ['AGENT.md', '---\nname: r\ncanCall: [helper]\n---\nx'], ['SOUL.md', 's'], ['PERSONA.md', 'p'], ['POLICY.yaml', 'defaultPermission: ask\n'],
    ]);
    await expect(packPdpkg({ name: '@a/r', version: '1.0.0', type: 'agent' }, files)).rejects.toThrow(/helper/);
    const ok = await packPdpkg({ name: '@a/r', version: '1.0.0', type: 'agent', dependencies: { '@a/helper': '^1.0.0' } }, files);
    expect((await openPdpkg(ok)).agentRefs).toEqual({ skills: [], agents: ['helper'], mcp: [] });
  });
});
