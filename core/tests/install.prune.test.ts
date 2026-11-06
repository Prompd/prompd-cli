// tests/install.prune.test.ts
import semver from 'semver';
import { installPackage, pruneInstalls, type InstalledPackage, type PackageStore } from '../src/lib/compiler/install';
import { packPdpkg } from '../src/lib/package/pack';
import type { PackageType } from '../src/types';

const enc = new TextEncoder();

interface Spec { name: string; version: string; type?: PackageType; dependencies?: Record<string, string> }

function makePkg(s: Spec): Promise<Uint8Array> {
  return packPdpkg(
    { name: s.name, version: s.version, type: s.type ?? 'package', ...(s.dependencies ? { dependencies: s.dependencies } : {}) },
    new Map([['README.md', `# ${s.name}@${s.version}`]]),
  );
}

/** A byte-backed PackageStore whose readdir is derived from the stored file paths. */
function memStore() {
  const bytes = new Map<string, Uint8Array>();
  const store: PackageStore = {
    writeFile(p, c) { bytes.set(p, enc.encode(c)); },
    writeBytes(p, b) { bytes.set(p, b); },
    removeDir(p) { for (const k of [...bytes.keys()]) if (k === p || k.startsWith(p + '/')) bytes.delete(k); },
    readBytes(p) {
      const b = bytes.get(p);
      if (!b) throw new Error(`ENOENT ${p}`);
      return b;
    },
    readdir(p) {
      const prefix = p + '/';
      const names = new Set<string>();
      for (const k of bytes.keys()) if (k.startsWith(prefix)) names.add(k.slice(prefix.length).split('/')[0]);
      return [...names];
    },
  };
  return { store, bytes, has: (p: string) => [...bytes.keys()].some((k) => k === p || k.startsWith(p + '/')) };
}

const ROOT = 'fleet';

async function installAll(store: PackageStore, specs: Spec[], ref: string): Promise<InstalledPackage> {
  const pkgs = await Promise.all(specs.map(async (s) => ({ ...s, bytes: await makePkg(s) })));
  const download = async (name: string, spec: string): Promise<Uint8Array> => {
    const mine = pkgs.filter((p) => p.name === name).sort((a, b) => semver.rcompare(a.version, b.version));
    const pick = !spec || spec === 'latest' ? mine[0] : mine.find((p) => semver.satisfies(p.version, spec));
    if (!pick) throw new Error(`no ${name}@${spec}`);
    return pick.bytes;
  };
  return installPackage({ ref, root: ROOT, installDir: '', store, download, global: true });
}

const keepOf = (r: InstalledPackage) => ({ name: r.name, version: r.version, digest: r.digest });

describe('pruneInstalls', () => {
  it('keeps a pinned install and its dependencies across type folders', async () => {
    const m = memStore();
    const specs: Spec[] = [
      { name: '@a/w', version: '1.0.0', type: 'workflow', dependencies: { '@a/s': '1.0.0' } },
      { name: '@a/s', version: '1.0.0', type: 'skill' },
      { name: '@a/x', version: '1.0.0' },
    ];
    const w = await installAll(m.store, specs, '@a/w@1.0.0');
    await installAll(m.store, specs, '@a/x@1.0.0');
    const res = await pruneInstalls({ root: ROOT, store: m.store, installDir: '', keep: [keepOf(w)] });
    expect(res.removed).toEqual(['packages/@a/x/1.0.0']);
    expect(res.kept).toEqual(['@a/s@1.0.0', '@a/w@1.0.0']);
    expect(m.has('fleet/skills/@a/s/1.0.0')).toBe(true);
    expect(m.has('fleet/workflows/@a/w/1.0.0')).toBe(true);
    expect(m.has('fleet/packages/@a/x')).toBe(false);
  });

  it('removes an unused version and keeps the used one of the same name', async () => {
    const m = memStore();
    const specs: Spec[] = [{ name: '@a/p', version: '1.0.0' }, { name: '@a/p', version: '2.0.0' }];
    await installAll(m.store, specs, '@a/p@1.0.0');
    const v2 = await installAll(m.store, specs, '@a/p@2.0.0');
    const res = await pruneInstalls({ root: ROOT, store: m.store, installDir: '', keep: [keepOf(v2)] });
    expect(res.removed).toEqual(['packages/@a/p/1.0.0']);
    expect(m.has('fleet/packages/@a/p/2.0.0')).toBe(true);
    expect(m.has('fleet/packages/@a/p/1.0.0')).toBe(false);
  });

  it('a dependency two installs share stays when one of them goes', async () => {
    const m = memStore();
    const specs: Spec[] = [
      { name: '@a/w1', version: '1.0.0', type: 'workflow', dependencies: { '@a/s': '1.0.0' } },
      { name: '@a/w2', version: '1.0.0', type: 'workflow', dependencies: { '@a/s': '1.0.0' } },
      { name: '@a/s', version: '1.0.0', type: 'skill' },
    ];
    const w1 = await installAll(m.store, specs, '@a/w1@1.0.0');
    await installAll(m.store, specs, '@a/w2@1.0.0');
    const res = await pruneInstalls({ root: ROOT, store: m.store, installDir: '', keep: [keepOf(w1)] });
    expect(res.removed).toEqual(['workflows/@a/w2/1.0.0']);
    expect(m.has('fleet/skills/@a/s/1.0.0')).toBe(true);
  });

  it('a dependency a kept install lists by range stays though it is not in keep', async () => {
    const m = memStore();
    const specs: Spec[] = [
      { name: '@a/w', version: '1.0.0', type: 'workflow', dependencies: { '@a/s': '^1.0.0' } },
      { name: '@a/s', version: '1.0.0', type: 'skill' },
      { name: '@a/s', version: '1.2.0', type: 'skill' },
      { name: '@a/s', version: '2.0.0', type: 'skill' },
    ];
    const w = await installAll(m.store, specs, '@a/w@1.0.0');
    await installAll(m.store, specs, '@a/s@1.0.0');
    await installAll(m.store, specs, '@a/s@2.0.0');
    const res = await pruneInstalls({ root: ROOT, store: m.store, installDir: '', keep: [keepOf(w)] });
    expect(res.removed).toEqual(['skills/@a/s/2.0.0']);
    expect(m.has('fleet/skills/@a/s/1.0.0')).toBe(true);
    expect(m.has('fleet/skills/@a/s/1.2.0')).toBe(true);
    expect(res.kept).toEqual(['@a/s@1.0.0', '@a/s@1.2.0', '@a/w@1.0.0']);
  });

  it('never touches name entries, dot folders, loose files or prompd.json', async () => {
    const m = memStore();
    const specs: Spec[] = [{ name: '@a/old', version: '1.0.0' }, { name: '@a/s', version: '1.0.0', type: 'skill' }];
    await installAll(m.store, specs, '@a/old@1.0.0');
    const s = await installAll(m.store, specs, '@a/s@1.0.0');
    const untouched = [
      'fleet/skills/lint/PACKAGE.json',
      'fleet/skills/.cache/blob',
      'fleet/skills/loose.txt',
      'fleet/skills/@a/notes.txt',
      'fleet/skills/@a/s/latest-backup/file',
      'fleet/packages/.hidden/file',
      'fleet/prompd.json',
      'fleet/crew/agent/PACKAGE.json',
    ];
    for (const p of untouched) m.bytes.set(p, enc.encode('x'));
    const res = await pruneInstalls({ root: ROOT, store: m.store, installDir: '', keep: [keepOf(s)] });
    expect(res.removed).toEqual(['packages/@a/old/1.0.0']);
    for (const p of untouched) expect(m.bytes.has(p)).toBe(true);
    expect(m.has('fleet/packages/@a')).toBe(false);
  });

  it('an unverifiable kept install blocks every removal and is reported', async () => {
    const m = memStore();
    const specs: Spec[] = [{ name: '@a/k', version: '1.0.0' }, { name: '@a/u', version: '1.0.0' }];
    const k = await installAll(m.store, specs, '@a/k@1.0.0');
    await installAll(m.store, specs, '@a/u@1.0.0');
    m.bytes.set('fleet/packages/@a/k/1.0.0/README.md', enc.encode('tampered'));
    const res = await pruneInstalls({ root: ROOT, store: m.store, installDir: '', keep: [keepOf(k)] });
    expect(res.removed).toEqual([]);
    expect(res.unverified).toHaveLength(1);
    expect(res.unverified[0].ref).toBe('@a/k@1.0.0');
    expect(res.unverified[0].reason).toMatch(/README\.md/);
    expect(m.has('fleet/packages/@a/u/1.0.0')).toBe(true);
  });

  it('a keep entry not on disk is ignored', async () => {
    const m = memStore();
    const specs: Spec[] = [{ name: '@a/k', version: '1.0.0' }, { name: '@a/u', version: '1.0.0' }];
    const k = await installAll(m.store, specs, '@a/k@1.0.0');
    await installAll(m.store, specs, '@a/u@1.0.0');
    const ghost = { name: '@a/ghost', version: '3.0.0', digest: `sha256:${'0'.repeat(64)}` };
    const res = await pruneInstalls({ root: ROOT, store: m.store, installDir: '', keep: [keepOf(k), ghost] });
    expect(res.unverified).toEqual([]);
    expect(res.removed).toEqual(['packages/@a/u/1.0.0']);
    expect(res.kept).toEqual(['@a/k@1.0.0']);
  });

  it('dryRun removes nothing and reports the same removed list', async () => {
    const m = memStore();
    const specs: Spec[] = [{ name: '@a/k', version: '1.0.0' }, { name: '@a/u', version: '1.0.0' }];
    const k = await installAll(m.store, specs, '@a/k@1.0.0');
    await installAll(m.store, specs, '@a/u@1.0.0');
    const before = [...m.bytes.keys()].sort();
    const dry = await pruneInstalls({ root: ROOT, store: m.store, installDir: '', keep: [keepOf(k)], dryRun: true });
    expect([...m.bytes.keys()].sort()).toEqual(before);
    const real = await pruneInstalls({ root: ROOT, store: m.store, installDir: '', keep: [keepOf(k)] });
    expect(dry.removed).toEqual(real.removed);
    expect(real.removed).toEqual(['packages/@a/u/1.0.0']);
  });

  it('a second run removes nothing', async () => {
    const m = memStore();
    const specs: Spec[] = [{ name: '@a/k', version: '1.0.0' }, { name: '@a/u', version: '1.0.0' }];
    const k = await installAll(m.store, specs, '@a/k@1.0.0');
    await installAll(m.store, specs, '@a/u@1.0.0');
    const first = await pruneInstalls({ root: ROOT, store: m.store, installDir: '', keep: [keepOf(k)] });
    expect(first.removed).toHaveLength(1);
    const second = await pruneInstalls({ root: ROOT, store: m.store, installDir: '', keep: [keepOf(k)] });
    expect(second.removed).toEqual([]);
    expect(second.kept).toEqual(['@a/k@1.0.0']);
  });

  it('requires a store with readdir, readBytes and removeDir', async () => {
    const store: PackageStore = { writeFile() { /* unused */ } };
    await expect(pruneInstalls({ root: ROOT, store, keep: [] })).rejects.toThrow(
      'pruneInstalls requires a PackageStore with readdir, readBytes and removeDir.',
    );
  });
});
