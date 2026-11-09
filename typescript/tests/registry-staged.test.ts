import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { packPdpkg, archiveDigest } from '@prompd/core';
import * as readline from 'readline';
import { RegistryClient, StagedNotSupportedError, StagedUnavailableError, archiveIntegrityHeader, parseStagedRef, type PublishOptions } from '../src/lib/registry';
import { ConfigManager } from '../src/lib/config';
import { createPublishCommand, createPromoteCommand, createDiscardCommand, createVersionsCommand } from '../src/commands/registry';
import { serve, type RecordedRequest, type Registry } from './helpers/fake-registry';

jest.setTimeout(30000);

jest.mock('readline', () => ({ ...jest.requireActual<typeof import('readline')>('readline'), createInterface: jest.fn() }));

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

describe('prompd publish command', () => {
  let tmp: string;
  let pkgDir: string;
  let reg: Registry;
  let exitSpy: jest.SpyInstance;
  let savedConfig: ConfigManager['config'];

  // The command builds its own client from the loaded config: point the registry at the fake one.
  const useRegistry = (url: string): void => {
    ConfigManager.getInstance().config = {
      apiKeys: {}, customProviders: {}, scopes: {}, maxRetries: 3, timeout: 30, verbose: false,
      registry: { registries: { prompdhub: { url } }, default: 'prompdhub' },
    };
  };

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prompd-staged-cmd-'));
    pkgDir = path.join(tmp, 'pkg');
    await fs.ensureDir(pkgDir);
    await fs.writeJson(path.join(pkgDir, 'prompd.json'), {
      name: NAME, version: VERSION, description: 'staged test', author: 'tester', files: ['**/*.prmd'],
    });
    await fs.writeFile(path.join(pkgDir, 'hello.prmd'), '---\nname: hello\n---\nHello\n');
    reg = await serve([], { onPut: () => ({ status: 201, body: STAGED_REPLY }) });
    savedConfig = ConfigManager.getInstance().config;
    useRegistry(reg.url);
    // The command calls process.exit inside its try block, so the mock must stop execution like the real one.
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    ConfigManager.getInstance().config = savedConfig;
    await reg.close();
    await fs.remove(tmp);
  });

  const run = (...args: string[]): Promise<unknown> =>
    createPublishCommand().parseAsync(['node', 'x', pkgDir, ...args]).then(() => null, (e: unknown) => e);

  it('--stage sends exactly one PUT, to /staged, and nothing to the live URL', async () => {
    expect(await run('--stage')).toBeNull();
    expect(reg.requests.map((r) => `${r.method} ${r.url}`)).toEqual([`PUT /packages/${NAME}/staged`]);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('without --stage publishes live (guards the test above from passing vacuously)', async () => {
    expect(await run()).toBeNull();
    expect(reg.requests.filter((r) => r.method === 'PUT').map((r) => r.url)).toEqual([`/packages/${NAME}`]);
  });

  it.each([
    ['--tag', ['--stage', '--tag', 'beta']],
    ['--force', ['--stage', '--force']],
  ])('--stage with %s exits 1 and sends no request', async (_flag, args) => {
    await run(...args);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(exitSpy.mock.calls.every((c) => c[0] === 1)).toBe(true);
    expect(reg.requests).toHaveLength(0);
  });

  it('--stage against a registry without the route exits 1 after one request and never publishes live', async () => {
    await reg.close();
    reg = await serve([], { onPut: () => ({ status: 404, body: { error: 'Not Found' } }) });
    useRegistry(reg.url);
    await run('--stage');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(reg.requests.map((r) => `${r.method} ${r.url}`)).toEqual([`PUT /packages/${NAME}/staged`]);
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

const HASH = 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const HASH_B = 'sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';
const stagedInfo = (version: string, status: 'staged' | 'promoting', integrity: string) => ({
  fullName: NAME, version, status, integrity, fileCount: 2,
  stagedAt: '2026-11-01T00:00:00.000Z', expiresAt: '2026-12-01T00:00:00.000Z', pullCount: 0, stagedBy: 'u1',
});
const LISTED = { status: 200, body: { versions: [stagedInfo('1.0.0', 'staged', HASH), stagedInfo('1.1.0', 'promoting', HASH_B)] } };
const PROMOTED = { status: 200, body: { success: true, fullName: NAME, version: '1.0.0', status: 'promoted', integrity: HASH } };

describe('parseStagedRef', () => {
  it('splits @scope/name@version', () => {
    expect(parseStagedRef('@t/p@1.0.0')).toEqual({ name: '@t/p', version: '1.0.0' });
    expect(parseStagedRef('@t/p@1.0.0-beta.1')).toEqual({ name: '@t/p', version: '1.0.0-beta.1' });
  });
  it.each(['@t/p', '@t/p@', 'p@1.0.0', '@t@1.0.0', '@T/P@1.0.0', '@t/p@1.0', '@t/p@1.0.0+build', '@../p@1.0.0', '@t/p/x@1.0.0'])('rejects %s', (arg) => {
    expect(parseStagedRef(arg)).toBeNull();
  });
});

describe('staged client methods', () => {
  let reg: Registry | null = null;
  afterEach(async () => { if (reg) await reg.close(); reg = null; });
  const clientFor = (r: Registry): RegistryClient => new RegistryClient({ registryUrl: r.url, cacheDir: path.join(os.tmpdir(), 'prompd-staged-unused') });

  it('listStaged GETs /staged and returns the versions', async () => {
    reg = await serve([], { onRequest: () => LISTED });
    const list = await clientFor(reg).listStaged(NAME);
    expect(reg.requests.map((r) => `${r.method} ${r.url}`)).toEqual([`GET /packages/${NAME}/staged`]);
    expect(list.map((v) => v.version)).toEqual(['1.0.0', '1.1.0']);
    expect(list[1].status).toBe('promoting');
  });

  it('listStaged throws StagedUnavailableError on 404', async () => {
    reg = await serve([], { onRequest: () => ({ status: 404, body: { error: 'Not Found' } }) });
    await expect(clientFor(reg).listStaged(NAME)).rejects.toBeInstanceOf(StagedUnavailableError);
  });

  it('listStaged rejects a malformed body', async () => {
    reg = await serve([], { onRequest: () => ({ status: 200, body: { versions: [{ version: 3 }] } }) });
    await expect(clientFor(reg).listStaged(NAME)).rejects.toThrow(/unexpected/i);
  });

  it('promoteStaged with an explicit integrity sends it as JSON and never reads the list', async () => {
    reg = await serve([], { onRequest: () => PROMOTED });
    const outcome = await clientFor(reg).promoteStaged(NAME, '1.0.0', 'sha256-given');
    expect(reg.requests.map((r) => `${r.method} ${r.url}`)).toEqual([`POST /packages/${NAME}/staged/1.0.0/promote`]);
    expect(JSON.parse(reg.requests[0].body.toString())).toEqual({ integrity: 'sha256-given' });
    expect(reg.requests[0].headers['content-type']).toContain('application/json');
    expect(outcome.success).toBe(true);
    expect(outcome.version).toBe('1.0.0');
  });

  it('promoteStaged without an integrity reads the list and sends that version hash', async () => {
    reg = await serve([], { onRequest: (r) => (r.method === 'GET' ? LISTED : PROMOTED) });
    await clientFor(reg).promoteStaged(NAME, '1.0.0');
    expect(reg.requests.map((r) => `${r.method} ${r.url}`)).toEqual([`GET /packages/${NAME}/staged`, `POST /packages/${NAME}/staged/1.0.0/promote`]);
    expect(JSON.parse(reg.requests[1].body.toString())).toEqual({ integrity: HASH });
  });

  it('promoteStaged surfaces the server refusal', async () => {
    reg = await serve([], { onRequest: () => ({ status: 409, body: { error: 'Version 1.0.0 already exists' } }) });
    await expect(clientFor(reg).promoteStaged(NAME, '1.0.0', 'sha256-x')).rejects.toThrow(/409.*Version 1.0.0 already exists/);
  });

  it('discardStaged sends DELETE', async () => {
    reg = await serve([], { onRequest: () => ({ status: 200, body: { success: true } }) });
    await clientFor(reg).discardStaged(NAME, '1.0.0');
    expect(reg.requests.map((r) => `${r.method} ${r.url}`)).toEqual([`DELETE /packages/${NAME}/staged/1.0.0`]);
  });

  it('discardStaged throws StagedUnavailableError on 404', async () => {
    reg = await serve([], { onRequest: () => ({ status: 404, body: { error: 'Package not found' } }) });
    await expect(clientFor(reg).discardStaged(NAME, '1.0.0')).rejects.toBeInstanceOf(StagedUnavailableError);
  });
});

describe('promote, discard and versions --staged commands', () => {
  type OnRequest = NonNullable<NonNullable<Parameters<typeof serve>[1]>['onRequest']>;
  let reg: Registry;
  let exitSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;
  let savedConfig: ConfigManager['config'];
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

  const useRegistry = (url: string): void => {
    ConfigManager.getInstance().config = {
      apiKeys: {}, customProviders: {}, scopes: {}, maxRetries: 3, timeout: 30, verbose: false,
      registry: { registries: { prompdhub: { url } }, default: 'prompdhub' },
    };
  };
  const setTty = (value: boolean | undefined): void => {
    Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true, writable: true });
  };
  const start = async (onRequest: OnRequest): Promise<void> => {
    reg = await serve([], { onRequest });
    useRegistry(reg.url);
  };
  const out = (): string => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
  const err = (): string => errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
  const run = (cmd: { parseAsync: (a: string[]) => Promise<unknown> }, ...args: string[]): Promise<unknown> =>
    cmd.parseAsync(['node', 'x', ...args]).then(() => null, (e: unknown) => e);
  const calls = (): string[] => reg.requests.map((r) => `${r.method} ${r.url}`);

  beforeEach(() => {
    savedConfig = ConfigManager.getInstance().config;
    // The commands call process.exit inside their try block, so the mock must stop execution like the real one.
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    if (ttyDescriptor) Object.defineProperty(process.stdin, 'isTTY', ttyDescriptor); else delete (process.stdin as { isTTY?: boolean }).isTTY;
    ConfigManager.getInstance().config = savedConfig;
    await reg.close();
  });

  it('promote without --integrity reads the list, sends that hash and prints it', async () => {
    await start((r) => (r.method === 'GET' ? LISTED : PROMOTED));
    expect(await run(createPromoteCommand(), `${NAME}@1.0.0`)).toBeNull();
    expect(calls()).toEqual([`GET /packages/${NAME}/staged`, `POST /packages/${NAME}/staged/1.0.0/promote`]);
    expect(JSON.parse(reg.requests[1].body.toString())).toEqual({ integrity: HASH });
    expect(out()).toContain(HASH);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('promote --integrity sends it without reading the list and prints it', async () => {
    await start(() => PROMOTED);
    expect(await run(createPromoteCommand(), `${NAME}@1.0.0`, '--integrity', 'sha256-given')).toBeNull();
    expect(calls()).toEqual([`POST /packages/${NAME}/staged/1.0.0/promote`]);
    expect(JSON.parse(reg.requests[0].body.toString())).toEqual({ integrity: 'sha256-given' });
    expect(out()).toContain('sha256-given');
  });

  it('promote of a promoting version still proceeds', async () => {
    await start((r) => (r.method === 'GET' ? LISTED : PROMOTED));
    await run(createPromoteCommand(), `${NAME}@1.1.0`);
    expect(JSON.parse(reg.requests[1].body.toString())).toEqual({ integrity: HASH_B });
  });

  it('promote of a version that is not staged says so, sends no POST and exits 1', async () => {
    await start(() => LISTED);
    await run(createPromoteCommand(), `${NAME}@9.9.9`);
    expect(err()).toMatch(/no staged version 9\.9\.9/i);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(calls()).toEqual([`GET /packages/${NAME}/staged`]);
  });

  it('promote with a 404 on the staged list shows the not-found-or-unsupported message and exits 1', async () => {
    await start(() => ({ status: 404, body: { error: 'Not Found' } }));
    await run(createPromoteCommand(), `${NAME}@1.0.0`);
    expect(err()).toMatch(/not found.*access.*does not support staged/i);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(calls()).toHaveLength(1);
  });

  it('promote reports a server refusal and exits 1', async () => {
    await start(() => ({ status: 409, body: { error: 'Version 1.0.0 already exists' } }));
    await run(createPromoteCommand(), `${NAME}@1.0.0`, '--integrity', 'sha256-x');
    expect(err()).toContain('Version 1.0.0 already exists');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it.each([
    ['no version', ['@t/p']],
    ['an invalid name', ['t/p@1.0.0']],
    ['an invalid version', ['@t/p@one']],
  ])('promote with %s exits 1 and sends no request', async (_label, args) => {
    await start(() => PROMOTED);
    await run(createPromoteCommand(), ...args);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(exitSpy.mock.calls.every((c) => c[0] === 1)).toBe(true);
    expect(err()).toMatch(/@scope\/name@version/);
    expect(reg.requests).toHaveLength(0);
  });

  it('discard --yes sends DELETE and says the number cannot be reused', async () => {
    await start(() => ({ status: 200, body: { success: true } }));
    expect(await run(createDiscardCommand(), `${NAME}@1.0.0`, '--yes')).toBeNull();
    expect(calls()).toEqual([`DELETE /packages/${NAME}/staged/1.0.0`]);
    expect(out()).toMatch(/cannot be reused/i);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('discard without --yes and without a terminal refuses, exits 1 and sends nothing', async () => {
    await start(() => ({ status: 200, body: { success: true } }));
    setTty(undefined);
    await run(createDiscardCommand(), `${NAME}@1.0.0`);
    expect(err()).toContain('--yes');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(reg.requests).toHaveLength(0);
  });

  it.each([
    ['y', true],
    ['n', false],
    ['', false],
  ])('discard on a terminal answering %p sends DELETE: %p', async (answer, sends) => {
    await start(() => ({ status: 200, body: { success: true } }));
    setTty(true);
    const asked: string[] = [];
    jest.mocked(readline.createInterface).mockReturnValueOnce({
      question: (q: string, cb: (a: string) => void) => { asked.push(q); cb(answer); },
      close: () => undefined,
    } as unknown as readline.Interface);
    await run(createDiscardCommand(), `${NAME}@1.0.0`);
    expect(asked.join('')).toMatch(/cannot be reused/i);
    expect(calls()).toEqual(sends ? [`DELETE /packages/${NAME}/staged/1.0.0`] : []);
    if (!sends) expect(exitSpy).not.toHaveBeenCalled();
  });

  it('discard with a malformed argument exits 1 and sends nothing', async () => {
    await start(() => ({ status: 200 }));
    await run(createDiscardCommand(), '@t/p', '--yes');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(reg.requests).toHaveLength(0);
  });

  it('discard 404 shows the not-found message and exits 1', async () => {
    await start(() => ({ status: 404, body: { error: 'Package not found' } }));
    await run(createDiscardCommand(), `${NAME}@1.0.0`, '--yes');
    expect(err()).toMatch(/not found.*access/i);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('versions --staged prints version, status, expiry and hash, and flags promoting', async () => {
    await start(() => LISTED);
    expect(await run(createVersionsCommand(), NAME, '--staged')).toBeNull();
    expect(calls()).toEqual([`GET /packages/${NAME}/staged`]);
    const text = out();
    expect(text).toContain('1.0.0');
    expect(text).toContain('staged');
    expect(text).toContain('2026-12-01');
    expect(text).toContain(HASH);
    expect(text).toContain('1.1.0');
    expect(text).toContain(HASH_B);
    expect(text.match(/promotion incomplete, run promote again/g)).toHaveLength(1);
  });

  it('versions --staged with nothing staged says so', async () => {
    await start(() => ({ status: 200, body: { versions: [] } }));
    await run(createVersionsCommand(), NAME, '--staged');
    expect(out()).toMatch(/no staged versions/i);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('versions --staged with a 404 shows the not-found-or-unsupported message and exits 1', async () => {
    await start(() => ({ status: 404 }));
    await run(createVersionsCommand(), NAME, '--staged');
    expect(err()).toMatch(/not found.*access.*does not support staged/i);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('versions without --staged never touches /staged', async () => {
    await start(() => undefined);
    await run(createVersionsCommand(), NAME);
    expect(calls()).toEqual([`GET /packages/${NAME}/versions`]);
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
