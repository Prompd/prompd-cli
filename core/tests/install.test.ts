// tests/install.test.ts
import semver from 'semver';
import { installPackage, uninstallPackage, INSTALL_LIMITS, type PackageStore } from '../src/lib/compiler/install';
import { packPdpkg } from '../src/lib/package/pack';
import { archiveDigest } from '../src/lib/package/digest';
import { PackageVerificationError } from '../src/lib/package/errors';
import type { PackageType } from '../src/types';
import JSZip from 'jszip';

interface PkgOpts { type?: PackageType; dependencies?: Record<string, string>; requires?: { mcp?: string[]; skills?: string[] } }

function makePkg(name: string, version: string, files: Record<string, string | Uint8Array>, o: PkgOpts = {}): Promise<Uint8Array> {
  return packPdpkg(
    { name, version, type: o.type ?? 'package', ...(o.dependencies ? { dependencies: o.dependencies } : {}), ...(o.requires ? { requires: o.requires } : {}) },
    new Map(Object.entries(files)),
  );
}

/** A fake registry that resolves a spec the way createRegistryDownloader does. */
function registry(pkgs: Array<{ name: string; version: string; bytes: Uint8Array }>) {
  return async (name: string, spec: string): Promise<Uint8Array> => {
    const mine = pkgs.filter((p) => p.name === name).sort((a, b) => semver.rcompare(a.version, b.version));
    const pick = !spec || spec === 'latest' ? mine[0] : mine.find((p) => semver.satisfies(p.version, spec));
    if (!pick) throw new Error(`no ${name}@${spec}`);
    return pick.bytes;
  };
}

/** A PackageStore backed by Maps. `bytes: false` models a text-only host. */
function memStore(opts: { bytes?: boolean } = {}) {
  const files = new Map<string, string>();
  const bytes = new Map<string, Uint8Array>();
  const removed: string[] = [];
  const prune = (path: string) => {
    for (const k of [...files.keys()]) if (k === path || k.startsWith(path + '/')) files.delete(k);
    for (const k of [...bytes.keys()]) if (k === path || k.startsWith(path + '/')) bytes.delete(k);
  };
  const store: PackageStore = {
    writeFile(path, content) { files.set(path, content); },
    ...(opts.bytes === false ? {} : { writeBytes(path: string, b: Uint8Array) { bytes.set(path, b); } }),
    removeDir(path) { removed.push(path); prune(path); },
    removeFile(path) { removed.push(path); files.delete(path); bytes.delete(path); },
    readFile(path) { return files.has(path) ? (files.get(path) as string) : null; },
  };
  const written = () => [...files.keys(), ...bytes.keys()];
  return { store, files, bytes, removed, written };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return 'ok'; } catch (e) { return e instanceof PackageVerificationError ? e.code : `other: ${String(e)}`; }
}

describe('installPackage', () => {
  it('installs the verified files, prompd.json, the archive copy and .prmdmeta', async () => {
    const buf = await makePkg('@acme/widget', '1.2.3', { 'prompts/main.prmd': '---\nid: main\n---\nhello' });
    const { store, bytes, files } = memStore();
    const res = await installPackage({ ref: '@acme/widget@1.2.3', root: 'ws', store, download: registry([{ name: '@acme/widget', version: '1.2.3', bytes: buf }]) });

    const dir = 'ws/.prompd/packages/@acme/widget/1.2.3';
    expect(res).toMatchObject({ name: '@acme/widget', version: '1.2.3', type: 'package', installedPath: dir, files: ['prompts/main.prmd'], dependencies: [] });
    expect(res.digest).toBe(await archiveDigest(buf));
    expect(new TextDecoder().decode(bytes.get(`${dir}/prompts/main.prmd`))).toContain('hello');
    expect(bytes.has(`${dir}/prompd.json`)).toBe(true);
    expect(bytes.get(`${dir}/.package.pdpkg`)).toEqual(buf);
    expect(JSON.parse(files.get(`${dir}/.prmdmeta`) as string)).toEqual({ name: '@acme/widget', version: '1.2.3', type: 'package', digest: res.digest });
  });

  it('writes binary files byte for byte', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const buf = await makePkg('@a/img', '1.0.0', { 'x.png': png });
    const { store, bytes } = memStore();
    await installPackage({ ref: '@a/img@1.0.0', root: 'ws', store, download: registry([{ name: '@a/img', version: '1.0.0', bytes: buf }]) });
    expect(bytes.get('ws/.prompd/packages/@a/img/1.0.0/x.png')).toEqual(png);
  });

  it('on a text-only store, installs text and refuses a binary file before writing anything', async () => {
    const text = await makePkg('@a/t', '1.0.0', { 'a.md': 'x' });
    const okStore = memStore({ bytes: false });
    await installPackage({ ref: '@a/t@1.0.0', root: 'ws', store: okStore.store, download: registry([{ name: '@a/t', version: '1.0.0', bytes: text }]) });
    expect(okStore.files.get('ws/.prompd/packages/@a/t/1.0.0/a.md')).toBe('x');

    const bin = await makePkg('@a/b', '1.0.0', { 'x.png': new Uint8Array([0xff, 0xfe]) });
    const s = memStore({ bytes: false });
    await expect(installPackage({ ref: '@a/b@1.0.0', root: 'ws', store: s.store, download: registry([{ name: '@a/b', version: '1.0.0', bytes: bin }]) })).rejects.toThrow(/binary/);
    expect(s.written()).toEqual([]);
    expect(s.removed).toEqual([]);
  });

  it('refuses a skill or agent on a text-only store, writing nothing', async () => {
    const skill = await makePkg('@a/s', '1.0.0', { 'SKILL.md': '# s' }, { type: 'skill' });
    const s = memStore({ bytes: false });
    await expect(installPackage({ ref: '@a/s@1.0.0', root: 'ws', store: s.store, download: registry([{ name: '@a/s', version: '1.0.0', bytes: skill }]) })).rejects.toThrow(/write bytes/);
    expect(s.written()).toEqual([]);
  });

  it('refuses an archive without integrity and touches nothing', async () => {
    const zip = new JSZip();
    zip.file('prompd.json', JSON.stringify({ name: '@a/x', version: '1.0.0' }));
    zip.file('a.md', 'x');
    const raw = await zip.generateAsync({ type: 'uint8array' });
    const s = memStore();
    expect(await codeOf(installPackage({ ref: '@a/x@1.0.0', root: 'ws', store: s.store, download: async () => raw }))).toBe('INTEGRITY_MISSING');
    expect(s.written()).toEqual([]);
    expect(s.removed).toEqual([]);
  });

  it('refuses a package whose manifest names a different package', async () => {
    const other = await makePkg('@b/y', '1.0.0', { 'a.md': 'x' });
    const s = memStore();
    expect(await codeOf(installPackage({ ref: '@a/x@1.0.0', root: 'ws', store: s.store, download: async () => other }))).toBe('NAME_MISMATCH');
    expect(s.written()).toEqual([]);
  });

  it('resolves a dependency range to the highest satisfying version (a range never round-trips through a ref string)', async () => {
    const reg = registry([
      { name: '@a/top', version: '1.0.0', bytes: await makePkg('@a/top', '1.0.0', { 'a.md': 'x' }, { dependencies: { '@a/dep': '^1.2.0' } }) },
      { name: '@a/dep', version: '1.2.0', bytes: await makePkg('@a/dep', '1.2.0', { 'd.md': '1' }) },
      { name: '@a/dep', version: '1.4.1', bytes: await makePkg('@a/dep', '1.4.1', { 'd.md': '2' }) },
      { name: '@a/dep', version: '2.0.0', bytes: await makePkg('@a/dep', '2.0.0', { 'd.md': '3' }) },
    ]);
    const res = await installPackage({ ref: '@a/top@1.0.0', root: 'ws', store: memStore().store, download: reg });
    expect(res.dependencies.map((d) => `${d.name}@${d.version}`)).toEqual(['@a/dep@1.4.1']);
  });

  it('accepts a range in the ref itself', async () => {
    const reg = registry([
      { name: '@a/x', version: '1.1.0', bytes: await makePkg('@a/x', '1.1.0', { 'a.md': '1' }) },
      { name: '@a/x', version: '1.3.0', bytes: await makePkg('@a/x', '1.3.0', { 'a.md': '3' }) },
    ]);
    const res = await installPackage({ ref: '@a/x@^1.0.0', root: 'ws', store: memStore().store, download: reg });
    expect(res.version).toBe('1.3.0');
    await expect(installPackage({ ref: 'unscoped@1.0.0', root: 'ws', store: memStore().store, download: reg })).rejects.toThrow(/Invalid package reference/);
  });

  it('holds the top package and its dependencies to lockfile pins', async () => {
    const top = await makePkg('@a/top', '1.0.0', { 'a.md': 'x' }, { dependencies: { '@a/dep': '1.0.0' } });
    const dep = await makePkg('@a/dep', '1.0.0', { 'd.md': 'd' });
    const reg = registry([{ name: '@a/top', version: '1.0.0', bytes: top }, { name: '@a/dep', version: '1.0.0', bytes: dep }]);
    const pins = new Map([['@a/top@1.0.0', await archiveDigest(top)], ['@a/dep@1.0.0', await archiveDigest(dep)]]);
    await expect(installPackage({ ref: '@a/top@1.0.0', root: 'ws', store: memStore().store, download: reg, pins })).resolves.toBeDefined();

    const badDep = new Map(pins);
    badDep.set('@a/dep@1.0.0', `sha256:${'0'.repeat(64)}`);
    expect(await codeOf(installPackage({ ref: '@a/top@1.0.0', root: 'ws', store: memStore().store, download: reg, pins: badDep }))).toBe('DIGEST_MISMATCH');
  });

  it('holds a range-resolved dependency to the version the lockfile pins, not the newest', async () => {
    const top = await makePkg('@x/top', '1.0.0', { 'a.md': 'x' }, { dependencies: { '@x/dep': '^1.2.0' } });
    const dep120 = await makePkg('@x/dep', '1.2.0', { 'd.md': '1.2.0' });
    const dep130 = await makePkg('@x/dep', '1.3.0', { 'd.md': '1.3.0' });
    const reg = registry([{ name: '@x/top', version: '1.0.0', bytes: top }, { name: '@x/dep', version: '1.2.0', bytes: dep120 }, { name: '@x/dep', version: '1.3.0', bytes: dep130 }]);
    const pins = new Map([['@x/dep@1.2.0', await archiveDigest(dep120)]]);
    const res = await installPackage({ ref: '@x/top@1.0.0', root: 'ws', store: memStore().store, download: reg, pins });
    expect(res.dependencies.map((d) => `${d.name}@${d.version}`)).toEqual(['@x/dep@1.2.0']);

    const rebuilt = await makePkg('@x/dep', '1.2.0', { 'd.md': 'not what was locked' });
    const s = memStore();
    const badPins = new Map([['@x/dep@1.2.0', await archiveDigest(rebuilt)]]);
    expect(await codeOf(installPackage({ ref: '@x/top@1.0.0', root: 'ws', store: s.store, download: reg, pins: badPins }))).toBe('DIGEST_MISMATCH');
    expect(s.written()).toEqual([]);
    expect(s.removed).toEqual([]);
  });

  it('refuses a manifest declaring more dependencies than the cap, before downloading them or writing anything', async () => {
    const deps: Record<string, string> = {};
    for (let i = 0; i <= INSTALL_LIMITS.maxDependencies; i++) deps[`@a/d${i}`] = '1.0.0';
    const top = await makePkg('@a/top', '1.0.0', { 'a.md': 'x' }, { dependencies: deps });
    const asked: string[] = [];
    const s = memStore();
    const download = async (name: string): Promise<Uint8Array> => { asked.push(name); if (name === '@a/top') return top; throw new Error(`no ${name}`); };
    expect(await codeOf(installPackage({ ref: '@a/top@1.0.0', root: 'ws', store: s.store, download }))).toBe('TOO_LARGE');
    expect(asked).toEqual(['@a/top']);
    expect(s.written()).toEqual([]);
    expect(INSTALL_LIMITS).toEqual({ maxDependencies: 100, maxPackages: 500, maxTotalBytes: 1073741824 });
  });

  it('refuses an agent whose canCall dependency turns out to be a skill', async () => {
    const helperSkill = await makePkg('@a/helper', '1.0.0', { 'SKILL.md': '# h' }, { type: 'skill' });
    const agent = await makePkg('@a/boss', '1.0.0', {
      'AGENT.md': '---\nname: boss\ncanCall: [helper]\n---\nLead.', 'SOUL.md': 's', 'PERSONA.md': 'p', 'POLICY.yaml': 'defaultPermission: ask\n',
    }, { type: 'agent', dependencies: { '@a/helper': '1.0.0' } });
    const reg = registry([{ name: '@a/boss', version: '1.0.0', bytes: agent }, { name: '@a/helper', version: '1.0.0', bytes: helperSkill }]);
    const s = memStore();
    expect(await codeOf(installPackage({ ref: '@a/boss@1.0.0', root: 'ws', store: s.store, download: reg }))).toBe('TYPE_INVALID');
    expect(s.written()).toEqual([]);
    expect(s.removed).toEqual([]);
  });

  it('writes nothing when a second dependency fails verification', async () => {
    const good = await makePkg('@a/good', '1.0.0', { 'g.md': 'g' });
    const bad = await makePkg('@a/bad', '1.0.0', { 'b.md': 'b' });
    const top = await makePkg('@a/top', '1.0.0', { 'a.md': 'x' }, { dependencies: { '@a/good': '1.0.0', '@a/bad': '1.0.0' } });
    const reg = registry([{ name: '@a/top', version: '1.0.0', bytes: top }, { name: '@a/good', version: '1.0.0', bytes: good }, { name: '@a/bad', version: '1.0.0', bytes: bad }]);
    const pins = new Map([['@a/bad@1.0.0', `sha256:${'0'.repeat(64)}`]]);
    const s = memStore();
    s.files.set('ws/prompd.json', '{}');
    expect(await codeOf(installPackage({ ref: '@a/top@1.0.0', root: 'ws', store: s.store, download: reg, pins }))).toBe('DIGEST_MISMATCH');
    expect(s.written()).toEqual(['ws/prompd.json']);
    expect(s.removed).toEqual([]);
  });

  it('reuses one install for a compatible diamond', async () => {
    const reg = registry([
      { name: '@a/top', version: '1.0.0', bytes: await makePkg('@a/top', '1.0.0', { 't.md': 't' }, { dependencies: { '@a/left': '1.0.0', '@a/right': '1.0.0' } }) },
      { name: '@a/left', version: '1.0.0', bytes: await makePkg('@a/left', '1.0.0', { 'l.md': 'l' }, { dependencies: { '@a/shared': '^1.0.0' } }) },
      { name: '@a/right', version: '1.0.0', bytes: await makePkg('@a/right', '1.0.0', { 'r.md': 'r' }, { dependencies: { '@a/shared': '>=1.1.0' } }) },
      { name: '@a/shared', version: '1.2.0', bytes: await makePkg('@a/shared', '1.2.0', { 's.md': 's' }) },
    ]);
    const res = await installPackage({ ref: '@a/top@1.0.0', root: 'ws', store: memStore().store, download: reg });
    const [left, right] = res.dependencies;
    expect(left.dependencies[0]).toBe(right.dependencies[0]);
    expect(left.dependencies[0].version).toBe('1.2.0');
  });

  it('refuses an incompatible diamond and writes nothing', async () => {
    const reg = registry([
      { name: '@a/top', version: '1.0.0', bytes: await makePkg('@a/top', '1.0.0', { 't.md': 't' }, { dependencies: { '@a/left': '1.0.0', '@a/right': '1.0.0' } }) },
      { name: '@a/left', version: '1.0.0', bytes: await makePkg('@a/left', '1.0.0', { 'l.md': 'l' }, { dependencies: { '@a/shared': '^1.0.0' } }) },
      { name: '@a/right', version: '1.0.0', bytes: await makePkg('@a/right', '1.0.0', { 'r.md': 'r' }, { dependencies: { '@a/shared': '^2.0.0' } }) },
      { name: '@a/shared', version: '1.2.0', bytes: await makePkg('@a/shared', '1.2.0', { 's.md': 's' }) },
      { name: '@a/shared', version: '2.0.0', bytes: await makePkg('@a/shared', '2.0.0', { 's.md': 's2' }) },
    ]);
    const s = memStore();
    await expect(installPackage({ ref: '@a/top@1.0.0', root: 'ws', store: s.store, download: reg }))
      .rejects.toThrow('@a/shared: @a/right needs ^2.0.0, but 1.2.0 is already part of this install');
    expect(s.written()).toEqual([]);
    expect(s.removed).toEqual([]);
  });

  it('refuses a cycle back to an ancestor at an incompatible version', async () => {
    const reg = registry([
      { name: '@a/one', version: '1.0.0', bytes: await makePkg('@a/one', '1.0.0', { 'a.md': '1' }, { dependencies: { '@a/two': '1.0.0' } }) },
      { name: '@a/two', version: '1.0.0', bytes: await makePkg('@a/two', '1.0.0', { 'b.md': '2' }, { dependencies: { '@a/one': '^2.0.0' } }) },
    ]);
    const s = memStore();
    await expect(installPackage({ ref: '@a/one@1.0.0', root: 'ws', store: s.store, download: reg })).rejects.toThrow(/@a\/one: @a\/two needs \^2\.0\.0, but 1\.0\.0/);
    expect(s.written()).toEqual([]);
  });

  it('refuses a dot-only package name before touching the store', async () => {
    const s = memStore();
    const reg = registry([]);
    await expect(installPackage({ ref: '@a/.', root: 'ws', store: s.store, download: reg })).rejects.toThrow(/Invalid package reference/);
    await expect(installPackage({ ref: '@a/..', root: 'ws', store: s.store, download: reg })).rejects.toThrow(/Invalid package reference/);
    await expect(installPackage({ ref: '@a/X@1.0.0', root: 'ws', store: s.store, download: reg })).rejects.toThrow(/Invalid package reference/);
    expect(s.written()).toEqual([]);
    expect(s.removed).toEqual([]);
  });

  it('terminates on a dependency cycle', async () => {
    const reg = registry([
      { name: '@a/one', version: '1.0.0', bytes: await makePkg('@a/one', '1.0.0', { 'a.md': '1' }, { dependencies: { '@a/two': '1.0.0' } }) },
      { name: '@a/two', version: '1.0.0', bytes: await makePkg('@a/two', '1.0.0', { 'b.md': '2' }, { dependencies: { '@a/one': '1.0.0' } }) },
    ]);
    const res = await installPackage({ ref: '@a/one@1.0.0', root: 'ws', store: memStore().store, download: reg });
    expect(res.dependencies.map((d) => d.name)).toEqual(['@a/two']);
  });

  it('accepts installDir "" (root is the state dir) and refuses anything but one dot-directory', async () => {
    const buf = await makePkg('@a/s', '1.0.0', { 'SKILL.md': '# s' }, { type: 'skill' });
    const reg = registry([{ name: '@a/s', version: '1.0.0', bytes: buf }]);
    const res = await installPackage({ ref: '@a/s@1.0.0', root: '', installDir: '', store: memStore().store, download: reg });
    expect(res.installedPath).toBe('skills/@a/s/1.0.0');
    await expect(installPackage({ ref: '@a/s@1.0.0', root: '', installDir: '../x', store: memStore().store, download: reg })).rejects.toThrow(/installDir/);
  });

  it('records the dependency in the workspace prompd.json unless global', async () => {
    const buf = await makePkg('@a/x', '1.0.0', { 'a.md': 'x' });
    const reg = registry([{ name: '@a/x', version: '1.0.0', bytes: buf }]);
    const local = memStore();
    local.files.set('ws/prompd.json', JSON.stringify({ name: 'mine', dependencies: { '@o/keep': '2.0.0' } }));
    await installPackage({ ref: '@a/x@1.0.0', root: 'ws', store: local.store, download: reg });
    expect(JSON.parse(local.files.get('ws/prompd.json') as string)).toEqual({ name: 'mine', dependencies: { '@o/keep': '2.0.0', '@a/x': '1.0.0' } });

    const global = memStore();
    await installPackage({ ref: '@a/x@1.0.0', root: 'home', store: global.store, download: reg, global: true });
    expect(global.files.has('home/prompd.json')).toBe(false);
  });

  it('records only the requested package in the workspace prompd.json, not its dependencies', async () => {
    const reg = registry([
      { name: '@a/top', version: '1.0.0', bytes: await makePkg('@a/top', '1.0.0', { 'a.md': 'x' }, { dependencies: { '@a/dep': '1.0.0' } }) },
      { name: '@a/dep', version: '1.0.0', bytes: await makePkg('@a/dep', '1.0.0', { 'd.md': 'd' }) },
    ]);
    const s = memStore();
    await installPackage({ ref: '@a/top@1.0.0', root: 'ws', store: s.store, download: reg });
    expect(JSON.parse(s.files.get('ws/prompd.json') as string)).toEqual({ dependencies: { '@a/top': '1.0.0' } });
  });
});

describe('uninstallPackage', () => {
  it('refuses a dot-only name and removes nothing', async () => {
    const s = memStore();
    await expect(uninstallPackage({ ref: '@a/..', root: 'ws', store: s.store })).rejects.toThrow(/Invalid package reference/);
    expect(s.removed).toEqual([]);
  });

  it('removes the package from every type dir, agents included', async () => {
    const s = memStore();
    await uninstallPackage({ ref: '@a/x', root: 'ws', store: s.store });
    expect(s.removed).toEqual([
      'ws/.prompd/packages/@a/x', 'ws/.prompd/workflows/@a/x', 'ws/.prompd/skills/@a/x', 'ws/.prompd/agents/@a/x',
    ]);
  });
});
