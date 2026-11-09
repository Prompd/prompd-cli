import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import AdmZip from 'adm-zip';
import { packPdpkg, archiveDigest, isPackageVerificationError } from '@prompd/core';
import { RegistryClient } from '../src/lib/registry';
import { serve, type Pkg } from './helpers/fake-registry';

jest.setTimeout(30000);

describe('RegistryClient.install (through core)', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prompd-install-')); });
  afterEach(async () => { await fs.remove(tmp); });

  it('installs a verified package with its range dependency, writing the archive copy and prompd.json', async () => {
    const dep = await packPdpkg({ name: '@t/dep', version: '1.4.0', type: 'package' }, new Map([['d.md', 'dep']]));
    const top = await packPdpkg({ name: '@t/top', version: '1.0.0', type: 'package', dependencies: { '@t/dep': '^1.0.0' } }, new Map([['a.md', 'top']]));
    const reg = await serve([{ name: '@t/top', version: '1.0.0', bytes: top }, { name: '@t/dep', version: '1.4.0', bytes: dep }]);
    try {
      const ws = path.join(tmp, 'ws');
      await fs.ensureDir(ws);
      const client = new RegistryClient({ registryUrl: reg.url, cacheDir: path.join(tmp, 'cache') });
      const res = await client.install('@t/top@1.0.0', { workspaceRoot: ws });
      expect(res.digest).toBe(await archiveDigest(top));
      expect(res.dependencies.map((d) => `${d.name}@${d.version}`)).toEqual(['@t/dep@1.4.0']);
      const dir = path.join(ws, '.prompd', 'packages', '@t', 'top', '1.0.0');
      expect(await fs.readFile(path.join(dir, 'a.md'), 'utf8')).toBe('top');
      expect(await fs.pathExists(path.join(dir, '.package.pdpkg'))).toBe(true);
      expect(await fs.readFile(path.join(ws, '.prompd', 'packages', '@t', 'dep', '1.4.0', 'd.md'), 'utf8')).toBe('dep');
      expect((await fs.readJson(path.join(ws, 'prompd.json'))).dependencies).toEqual({ '@t/top': '1.0.0' });
    } finally {
      await reg.close();
    }
  });

  it('refuses a tampered package and writes nothing', async () => {
    const good = await packPdpkg({ name: '@t/x', version: '1.0.0', type: 'package' }, new Map([['a.md', 'aaaa']]));
    const bad = Buffer.from(good);
    // Flip a byte inside the a.md entry: either the CRC or the integrity hash fails, both refusals.
    const at = bad.indexOf(Buffer.from('a.md')) + 40;
    bad[at] = bad[at] ^ 0xff;
    const reg = await serve([{ name: '@t/x', version: '1.0.0', bytes: new Uint8Array(bad) }]);
    try {
      const ws = path.join(tmp, 'ws');
      await fs.ensureDir(ws);
      const client = new RegistryClient({ registryUrl: reg.url, cacheDir: path.join(tmp, 'cache') });
      const err: unknown = await client.install('@t/x@1.0.0', { workspaceRoot: ws }).then(() => null, (e: unknown) => e);
      expect(isPackageVerificationError(err)).toBe(true);
      expect((err as { code: string }).code).toBe('ARCHIVE_INVALID');
      expect(await fs.pathExists(path.join(ws, '.prompd'))).toBe(false);
    } finally {
      await reg.close();
    }
  });

  // A well-formed archive passes the ZIP checks, so only the integrity record can catch these.
  it.each([
    ['a changed file', 'HASH_MISMATCH', (zip: AdmZip) => { zip.updateFile('a.md', Buffer.from('changed')); }],
    ['an added file', 'FILE_UNLISTED', (zip: AdmZip) => { zip.addFile('b.md', Buffer.from('added')); }],
    ['a removed file', 'FILE_MISSING', (zip: AdmZip) => { zip.deleteFile('a.md'); }],
    ['a different package name', 'NAME_MISMATCH', (zip: AdmZip) => {
      const manifest = JSON.parse(zip.readAsText('prompd.json')) as Record<string, unknown>;
      zip.updateFile('prompd.json', Buffer.from(JSON.stringify({ ...manifest, name: '@attacker/other' })));
    }],
  ])('refuses a well-formed archive with %s and writes nothing', async (_label, code, tamper) => {
    const zip = new AdmZip(Buffer.from(await packPdpkg({ name: '@t/w', version: '1.0.0', type: 'package' }, new Map([['a.md', 'aaaa']]))));
    tamper(zip);
    const reg = await serve([{ name: '@t/w', version: '1.0.0', bytes: new Uint8Array(zip.toBuffer()) }]);
    try {
      const ws = path.join(tmp, 'ws');
      await fs.ensureDir(ws);
      const cacheDir = path.join(tmp, 'cache');
      const client = new RegistryClient({ registryUrl: reg.url, cacheDir });
      const err: unknown = await client.install('@t/w@1.0.0', { workspaceRoot: ws }).then(() => null, (e: unknown) => e);
      expect(isPackageVerificationError(err)).toBe(true);
      expect((err as { code: string }).code).toBe(code);
      expect(await fs.pathExists(path.join(ws, '.prompd'))).toBe(false);
      expect(await fs.pathExists(path.join(cacheDir, 'packages', '@t', 'w@1.0.0'))).toBe(false);
    } finally {
      await reg.close();
    }
  });

  it('serves a cache hit only when its digest matches, and re-downloads a tampered cache entry', async () => {
    const pkg = await packPdpkg({ name: '@t/c', version: '1.0.0', type: 'package' }, new Map([['a.md', 'c']]));
    const reg = await serve([{ name: '@t/c', version: '1.0.0', bytes: pkg }]);
    try {
      const ws = path.join(tmp, 'ws');
      await fs.ensureDir(ws);
      const cacheDir = path.join(tmp, 'cache');
      const client = new RegistryClient({ registryUrl: reg.url, cacheDir });
      await client.install('@t/c@1.0.0', { workspaceRoot: ws });
      const downloadsAfterFirst = reg.hits.filter((h) => h.includes('/download/')).length;

      await client.install('@t/c@1.0.0', { workspaceRoot: ws });
      expect(reg.hits.filter((h) => h.includes('/download/')).length).toBe(downloadsAfterFirst);

      await fs.writeFile(path.join(cacheDir, 'packages', '@t', 'c@1.0.0'), Buffer.from('tampered'));
      await client.install('@t/c@1.0.0', { workspaceRoot: ws });
      expect(reg.hits.filter((h) => h.includes('/download/')).length).toBe(downloadsAfterFirst + 1);
    } finally {
      await reg.close();
    }
  });

  it('does not cache a download that failed verification, so a later good response installs', async () => {
    const good = await packPdpkg({ name: '@t/r', version: '1.0.0', type: 'package' }, new Map([['a.md', 'aaaa']]));
    const bad = Buffer.from(good);
    bad[bad.indexOf(Buffer.from('a.md')) + 40] ^= 0xff;
    const pkgs: Pkg[] = [{ name: '@t/r', version: '1.0.0', bytes: new Uint8Array(bad) }];
    const reg = await serve(pkgs);
    try {
      const ws = path.join(tmp, 'ws');
      await fs.ensureDir(ws);
      const client = new RegistryClient({ registryUrl: reg.url, cacheDir: path.join(tmp, 'cache') });
      await expect(client.install('@t/r@1.0.0', { workspaceRoot: ws })).rejects.toThrow();
      pkgs[0] = { name: '@t/r', version: '1.0.0', bytes: good };
      await client.install('@t/r@1.0.0', { workspaceRoot: ws });
      expect(reg.hits.filter((h) => h.includes('/download/')).length).toBe(2);
      expect(await fs.readFile(path.join(ws, '.prompd', 'packages', '@t', 'r', '1.0.0', 'a.md'), 'utf8')).toBe('aaaa');
    } finally {
      await reg.close();
    }
  });

  it('downloadPackageBuffer accepts the unversioned ref (latest) and an exact version', async () => {
    const pkg = await packPdpkg({ name: '@t/x', version: '1.2.0', type: 'package' }, new Map([['a.md', 'x']]));
    const reg = await serve([{ name: '@t/x', version: '1.2.0', bytes: pkg }]);
    try {
      const client = new RegistryClient({ registryUrl: reg.url, cacheDir: path.join(tmp, 'cache') });
      const latest = await client.downloadPackageBuffer('@t/x', 'latest');
      expect(latest.metadata.version).toBe('1.2.0');
      expect(new Uint8Array(latest.tarball)).toEqual(pkg);
      const exact = await client.downloadPackageBuffer('@t/x', '1.2.0');
      expect(exact.metadata.version).toBe('1.2.0');
    } finally {
      await reg.close();
    }
  });

  it('uninstalls through core and drops the workspace dependency', async () => {
    const pkg = await packPdpkg({ name: '@t/u', version: '1.0.0', type: 'package' }, new Map([['a.md', 'u']]));
    const reg = await serve([{ name: '@t/u', version: '1.0.0', bytes: pkg }]);
    try {
      const ws = path.join(tmp, 'ws');
      await fs.ensureDir(ws);
      const client = new RegistryClient({ registryUrl: reg.url, cacheDir: path.join(tmp, 'cache') });
      await client.install('@t/u@1.0.0', { workspaceRoot: ws });
      await client.uninstall('@t/u', { workspaceRoot: ws });
      expect(await fs.pathExists(path.join(ws, '.prompd', 'packages', '@t', 'u'))).toBe(false);
      expect((await fs.readJson(path.join(ws, 'prompd.json'))).dependencies).toEqual({});
      await expect(client.uninstall('@t/u', { workspaceRoot: ws })).rejects.toThrow(/is not installed/);
    } finally {
      await reg.close();
    }
  });
});
