import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { packPdpkg, archiveDigest } from '@prompd/core';
import { RegistryClient, StagedNotSupportedError, archiveIntegrityHeader, type PublishOptions } from '../src/lib/registry';
import { serve, type RecordedRequest, type Registry } from './helpers/fake-registry';

jest.setTimeout(30000);

const NAME = '@t/p';
const VERSION = '1.0.0';

const STAGED_REPLY = { success: true, fullName: NAME, version: VERSION, status: 'staged', integrity: 'sha256-x', expiresAt: '2026-12-08T00:00:00.000Z' };

function publishOptions(extra: Partial<PublishOptions> = {}): PublishOptions {
  return { access: 'public', tag: 'latest', dryRun: false, force: false, authToken: 'tok', ...extra };
}

/** The bytes of the multipart part named `field`, exactly as received. */
function multipartPart(request: RecordedRequest, field: string): Buffer {
  const contentType = String(request.headers['content-type']);
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!boundary) throw new Error(`not multipart: ${contentType}`);
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let from = 0;
  for (;;) {
    const start = request.body.indexOf(delimiter, from);
    if (start < 0) throw new Error(`no part named ${field}`);
    const headEnd = request.body.indexOf(Buffer.from('\r\n\r\n'), start);
    const head = request.body.subarray(start, headEnd).toString('latin1');
    const next = request.body.indexOf(Buffer.concat([Buffer.from('\r\n'), delimiter]), headEnd);
    if (head.includes(`name="${field}"`)) return request.body.subarray(headEnd + 4, next);
    from = start + delimiter.length;
  }
}

describe('publish --stage and the integrity header', () => {
  let tmp: string;
  let pkgDir: string;
  let reg: Registry | null = null;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prompd-staged-'));
    pkgDir = path.join(tmp, 'pkg');
    await fs.ensureDir(pkgDir);
    await fs.writeJson(path.join(pkgDir, 'prompd.json'), {
      name: NAME, version: VERSION, description: 'staged test', author: 'tester', files: ['**/*.prmd'],
    });
    await fs.writeFile(path.join(pkgDir, 'hello.prmd'), '---\nname: hello\n---\nHello\n');
  });
  afterEach(async () => {
    if (reg) await reg.close();
    reg = null;
    await fs.remove(tmp);
  });

  const clientFor = (r: Registry): RegistryClient => new RegistryClient({ registryUrl: r.url, cacheDir: path.join(tmp, 'cache') });

  it('PUTs to /packages/@t/p/staged, never to /packages/@t/p, and returns the parsed 201', async () => {
    reg = await serve([], { onPut: () => ({ status: 201, body: STAGED_REPLY }) });
    const result = await clientFor(reg).publish(pkgDir, publishOptions({ stage: true }));

    const puts = reg.requests.filter((r) => r.method === 'PUT');
    expect(puts.map((r) => r.url)).toEqual([`/packages/${NAME}/staged`]);
    expect(reg.requests.some((r) => r.url === `/packages/${NAME}`)).toBe(false);
    expect(result).toEqual(STAGED_REPLY);
  });

  it('skips the version pre-check when staging, since the server 409 is the check', async () => {
    reg = await serve([], { onPut: () => ({ status: 201, body: STAGED_REPLY }) });
    await clientFor(reg).publish(pkgDir, publishOptions({ stage: true }));
    expect(reg.requests.map((r) => r.method)).toEqual(['PUT']);
  });

  it('throws StagedNotSupportedError on 404, makes no second request, and never falls back to normal publish', async () => {
    reg = await serve([], { onPut: () => ({ status: 404, body: { error: 'Not Found' } }) });
    const err: unknown = await clientFor(reg).publish(pkgDir, publishOptions({ stage: true })).then(() => null, (e: unknown) => e);

    expect(err).toBeInstanceOf(StagedNotSupportedError);
    expect((err as Error).message).toBe('this registry does not support staged publishing, or the namespace was not found');
    expect(reg.requests.map((r) => `${r.method} ${r.url}`)).toEqual([`PUT /packages/${NAME}/staged`]);
  });

  it('on 409 reports the server error and the integrity when the server sent it', async () => {
    reg = await serve([], { onPut: () => ({ status: 409, body: { error: 'Version 1.0.0 already exists', status: 'staged', integrity: 'sha256-abc=' } }) });
    const err: unknown = await clientFor(reg).publish(pkgDir, publishOptions({ stage: true })).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('Version 1.0.0 already exists');
    expect((err as Error).message).toContain('sha256-abc=');
    expect(reg.requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
  });

  it('on 409 for a write-only caller reports just the error', async () => {
    reg = await serve([], { onPut: () => ({ status: 409, body: { error: 'Version 1.0.0 already exists' } }) });
    const err: unknown = await clientFor(reg).publish(pkgDir, publishOptions({ stage: true })).then(() => null, (e: unknown) => e);
    expect((err as Error).message).toContain('Version 1.0.0 already exists');
    expect((err as Error).message).not.toContain('sha256');
  });

  it('reports a rejected staged upload with its status', async () => {
    reg = await serve([], { onPut: () => ({ status: 413, body: { error: 'too large' } }) });
    await expect(clientFor(reg).publish(pkgDir, publishOptions({ stage: true }))).rejects.toThrow(/413/);
  });

  it.each([
    ['--tag', { tag: 'beta' }],
    ['--force', { force: true }],
  ])('refuses --stage with %s before any request', async (_flag, extra) => {
    reg = await serve([]);
    await expect(clientFor(reg).publish(pkgDir, publishOptions({ stage: true, ...extra }))).rejects.toThrow(/--stage/);
    expect(reg.requests).toHaveLength(0);
  });

  it.each([
    ['normal publish', false, `/packages/${NAME}`],
    ['staged publish', true, `/packages/${NAME}/staged`],
  ])('%s sends X-Package-Integrity equal to the base64 SHA-256 of the uploaded archive', async (_label, stage, putUrl) => {
    reg = await serve([], { onPut: () => ({ status: stage ? 201 : 200, body: stage ? STAGED_REPLY : { success: true } }) });
    await clientFor(reg).publish(pkgDir, publishOptions({ stage }));

    const put = reg.requests.find((r) => r.method === 'PUT');
    expect(put?.url).toBe(putUrl);
    const sent = put!.headers['x-package-integrity'];
    const uploaded = multipartPart(put!, 'package');
    expect(uploaded.length).toBeGreaterThan(0);
    expect(sent).toBe(`sha256-${crypto.createHash('sha256').update(uploaded).digest('base64')}`);
    expect(sent).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/);
  });
});

describe('archiveIntegrityHeader', () => {
  it('converts core sha256:<hex> to sha256-<base64> of the same bytes', async () => {
    const bytes = await packPdpkg({ name: NAME, version: VERSION, type: 'package' }, new Map([['a.md', 'x']]));
    const header = await archiveIntegrityHeader(bytes);
    const hex = (await archiveDigest(bytes)).replace(/^sha256:/, '');
    expect(Buffer.from(header.replace(/^sha256-/, ''), 'base64').toString('hex')).toBe(hex);
    expect(header).toBe(`sha256-${crypto.createHash('sha256').update(bytes).digest('base64')}`);
  });
});

describe('install of a version served only with auth', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prompd-staged-install-')); });
  afterEach(async () => { await fs.remove(tmp); });

  async function installFrom(token: string | undefined): Promise<{ result: unknown; ws: string; reg: Registry }> {
    const pkg = await packPdpkg({ name: NAME, version: VERSION, type: 'package' }, new Map([['a.md', 'staged']]));
    const reg = await serve([{ name: NAME, version: VERSION, bytes: pkg }], { requireToken: 'tok' });
    const ws = path.join(tmp, `ws-${token ?? 'anon'}`);
    await fs.ensureDir(ws);
    const client = new RegistryClient({ registryUrl: reg.url, cacheDir: path.join(tmp, `cache-${token ?? 'anon'}`) });
    Object.defineProperty(client, 'authToken', { get: () => token });
    const result: unknown = await client.install(`${NAME}@${VERSION}`, { workspaceRoot: ws }).then((r) => r, (e: unknown) => e);
    return { result, ws, reg };
  }

  it('installs the exact version with auth', async () => {
    const { result, ws, reg } = await installFrom('tok');
    try {
      expect(result).toBeInstanceOf(Object);
      expect((result as { version: string }).version).toBe(VERSION);
      expect(await fs.readFile(path.join(ws, '.prompd', 'packages', '@t', 'p', VERSION, 'a.md'), 'utf8')).toBe('staged');
      expect(reg.requests.every((r) => r.headers.authorization === 'Bearer tok')).toBe(true);
    } finally {
      await reg.close();
    }
  });

  it('fails without auth, with the normal error, and writes nothing', async () => {
    const { result, ws, reg } = await installFrom(undefined);
    try {
      expect(result).toBeInstanceOf(Error);
      expect(await fs.pathExists(path.join(ws, '.prompd'))).toBe(false);
    } finally {
      await reg.close();
    }
  });
});
