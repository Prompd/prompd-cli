import JSZip from 'jszip';
import { installPackage, uninstallPackage, type PackageStore } from '../src/lib/compiler/install';

/** Build an in-memory .pdpkg (ZIP) from a path -> content map. */
async function makePkg(entries: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) zip.file(path, content);
  return zip.generateAsync({ type: 'uint8array' });
}

/** A PackageStore backed by Maps (text + bytes) — the test double for a host FS. */
function memStore() {
  const files = new Map<string, string>();
  const bytes = new Map<string, Uint8Array>();
  const removed: string[] = [];
  const prune = (path: string) => {
    for (const k of [...files.keys()]) if (k === path || k.startsWith(path + '/')) files.delete(k);
    for (const k of [...bytes.keys()]) if (k === path || k.startsWith(path + '/')) bytes.delete(k);
  };
  const store: PackageStore = {
    writeFile(path, content) { files.set(path, content); },
    writeBytes(path, b) { bytes.set(path, b); },
    removeDir(path) { removed.push(path); prune(path); },
    removeFile(path) { removed.push(path); files.delete(path); bytes.delete(path); },
    readFile(path) { return files.has(path) ? files.get(path)! : null; },
    readBytes(path) { const b = bytes.get(path); if (!b) throw new Error(`not found: ${path}`); return b; },
    readdir(path) {
      const prefix = path.endsWith('/') ? path : path + '/';
      const names = new Set<string>();
      for (const k of [...files.keys(), ...bytes.keys()]) {
        if (k.startsWith(prefix)) names.add(k.slice(prefix.length).split('/')[0]);
      }
      return [...names];
    },
  };
  return { store, files, bytes, removed };
}

describe('installPackage', () => {
  it('installs into <root>/.prompd/packages/<@scope/name>/<version>/ with manifest name+version+type', async () => {
    const buf = await makePkg({
      'manifest.json': JSON.stringify({ name: '@acme/widget', version: '1.2.3', type: 'package' }),
      'prompts/main.prmd': '---\nid: main\n---\nhello',
    });
    const { store, files } = memStore();

    const res = await installPackage({ ref: '@acme/widget', root: 'ws', store, download: async () => buf });

    expect(res.name).toBe('@acme/widget');
    expect(res.version).toBe('1.2.3');
    expect(res.type).toBe('package');
    expect(res.installedPath).toBe('ws/.prompd/packages/@acme/widget/1.2.3');
    expect(res.files).toEqual(expect.arrayContaining(['manifest.json', 'prompts/main.prmd']));
    expect(files.get('ws/.prompd/packages/@acme/widget/1.2.3/prompts/main.prmd')).toContain('hello');
  });

  it('derives the type from the package manifest, not the caller hint', async () => {
    const buf = await makePkg({ 'manifest.json': JSON.stringify({ name: '@x/s', version: '1.0.0', type: 'skill' }), 'SKILL.md': '#' });
    const { store } = memStore();

    const res = await installPackage({ ref: '@x/s', type: 'package', root: 'ws', store, download: async () => buf }); // hint says 'package'

    expect(res.type).toBe('skill');
    expect(res.installedPath).toBe('ws/.prompd/skills/@x/s/1.0.0');
  });

  it('writes a .prmdmeta with the manifest into the version dir', async () => {
    const buf = await makePkg({ 'manifest.json': JSON.stringify({ name: '@acme/widget', version: '1.2.3' }), 'a.md': 'x' });
    const { store, files } = memStore();

    await installPackage({ ref: '@acme/widget', root: 'ws', store, download: async () => buf });

    const meta = JSON.parse(files.get('ws/.prompd/packages/@acme/widget/1.2.3/.prmdmeta')!);
    expect(meta.name).toBe('@acme/widget');
  });

  it('stores a node-template as the raw .pdpkg (not extracted)', async () => {
    const buf = await makePkg({ 'manifest.json': JSON.stringify({ name: '@x/tmpl', version: '1.0.0', type: 'node-template' }), 'node.md': 'n' });
    const { store, bytes, files } = memStore();

    const res = await installPackage({ ref: '@x/tmpl', root: 'ws', store, download: async () => buf });

    expect(res.type).toBe('node-template');
    expect(res.installedPath).toBe('ws/.prompd/templates/x-tmpl-1.0.0.pdpkg');
    expect(bytes.has('ws/.prompd/templates/x-tmpl-1.0.0.pdpkg')).toBe(true);
    expect([...files.keys()].some((k) => k.startsWith('ws/.prompd/templates/'))).toBe(false); // not extracted
  });

  it('installs the package\'s own dependencies recursively', async () => {
    const widget = await makePkg({ 'manifest.json': JSON.stringify({ name: '@a/widget', version: '1.0.0', dependencies: { '@a/dep': '2.0.0' } }), 'w.md': 'w' });
    const dep = await makePkg({ 'manifest.json': JSON.stringify({ name: '@a/dep', version: '2.0.0' }), 'd.md': 'd' });
    const { store, files } = memStore();

    await installPackage({ ref: '@a/widget', root: 'ws', store, download: async (name) => (name === '@a/dep' ? dep : widget) });

    expect(files.get('ws/.prompd/packages/@a/widget/1.0.0/w.md')).toBe('w');
    expect(files.get('ws/.prompd/packages/@a/dep/2.0.0/d.md')).toBe('d');
    const manifest = JSON.parse(files.get('ws/prompd.json')!);
    expect(manifest.dependencies['@a/widget']).toBe('1.0.0');
    expect(manifest.dependencies['@a/dep']).toBe('2.0.0');
  });

  it('skips the workspace prompd.json on a global install', async () => {
    const buf = await makePkg({ 'manifest.json': JSON.stringify({ name: '@x/y', version: '1.0.0' }), 'a.md': 'x' });
    const { store, files } = memStore();

    await installPackage({ ref: '@x/y', root: 'r', store, download: async () => buf, global: true });

    expect(files.has('r/prompd.json')).toBe(false);
  });

  it('clears the version dir before writing (idempotent)', async () => {
    const buf = await makePkg({ 'manifest.json': JSON.stringify({ name: '@x/y', version: '1.0.0' }), 'a.md': 'A' });
    const { store, removed } = memStore();

    await installPackage({ ref: '@x/y', root: 'r', store, download: async () => buf });

    expect(removed).toContain('r/.prompd/packages/@x/y/1.0.0');
  });

  it('throws on an archive with no installable files', async () => {
    const buf = await makePkg({});
    const { store } = memStore();

    await expect(installPackage({ ref: '@x/y', root: 'r', store, download: async () => buf })).rejects.toThrow(/no installable files/);
  });

  it('throws installing a node-template without writeBytes support', async () => {
    const buf = await makePkg({ 'manifest.json': JSON.stringify({ name: '@x/t', version: '1.0.0', type: 'node-template' }), 'n.md': 'n' });
    const store: PackageStore = { writeFile: () => {} }; // no writeBytes

    await expect(installPackage({ ref: '@x/t', root: 'r', store, download: async () => buf })).rejects.toThrow(/writeBytes/);
  });
});

describe('uninstallPackage', () => {
  it('removes the package dir (all versions) by name, scanning every type', async () => {
    const buf = await makePkg({ 'manifest.json': JSON.stringify({ name: '@acme/widget', version: '1.0.0', type: 'skill' }), 'SKILL.md': '#' });
    const { store, files, removed } = memStore();
    await installPackage({ ref: '@acme/widget', root: 'ws', store, download: async () => buf });

    const res = await uninstallPackage({ ref: '@acme/widget', root: 'ws', store });

    expect(res.name).toBe('@acme/widget');
    expect(res.removed).toContain('ws/.prompd/skills/@acme/widget');
    expect([...files.keys()].some((k) => k.startsWith('ws/.prompd/skills/@acme/widget/'))).toBe(false);
  });

  it('removes a node-template .pdpkg by matching its manifest name (exact)', async () => {
    const buf = await makePkg({ 'manifest.json': JSON.stringify({ name: '@x/tmpl', version: '1.0.0', type: 'node-template' }), 'n.md': 'n' });
    const { store, bytes } = memStore();
    await installPackage({ ref: '@x/tmpl', root: 'ws', store, download: async () => buf });
    expect(bytes.has('ws/.prompd/templates/x-tmpl-1.0.0.pdpkg')).toBe(true);

    const res = await uninstallPackage({ ref: '@x/tmpl', root: 'ws', store });

    expect(res.removed).toContain('ws/.prompd/templates/x-tmpl-1.0.0.pdpkg');
    expect(bytes.has('ws/.prompd/templates/x-tmpl-1.0.0.pdpkg')).toBe(false);
  });

  it('does NOT delete a slug-prefix sibling node-template', async () => {
    const foo = await makePkg({ 'manifest.json': JSON.stringify({ name: '@s/foo', version: '1.0.0', type: 'node-template' }), 'n.md': 'foo' });
    const bar = await makePkg({ 'manifest.json': JSON.stringify({ name: '@s/foo-bar', version: '1.0.0', type: 'node-template' }), 'n.md': 'bar' });
    const { store, bytes } = memStore();
    await installPackage({ ref: '@s/foo', root: 'ws', store, download: async () => foo });
    await installPackage({ ref: '@s/foo-bar', root: 'ws', store, download: async () => bar });

    await uninstallPackage({ ref: '@s/foo', root: 'ws', store }); // slug prefix 's-foo-' also prefixes 's-foo-bar-'

    expect(bytes.has('ws/.prompd/templates/s-foo-1.0.0.pdpkg')).toBe(false);
    expect(bytes.has('ws/.prompd/templates/s-foo-bar-1.0.0.pdpkg')).toBe(true); // sibling survives
  });

  it('throws when the store cannot remove directories', async () => {
    const store: PackageStore = { writeFile: () => {} }; // no removeDir
    await expect(uninstallPackage({ ref: '@x/y', root: 'r', store })).rejects.toThrow(/removeDir/);
  });
});

describe('prompd.json dependency tracking', () => {
  it('upserts dependencies[name]=version on install, creating the manifest', async () => {
    const buf = await makePkg({ 'manifest.json': JSON.stringify({ name: '@acme/widget', version: '1.2.3' }), 'a.md': 'x' });
    const { store, files } = memStore();

    await installPackage({ ref: '@acme/widget', root: 'ws', store, download: async () => buf });

    expect(JSON.parse(files.get('ws/prompd.json')!).dependencies['@acme/widget']).toBe('1.2.3');
  });

  it('merges into an existing prompd.json without clobbering other fields/deps', async () => {
    const buf = await makePkg({ 'manifest.json': JSON.stringify({ name: '@acme/widget', version: '1.0.0' }), 'a.md': 'x' });
    const { store, files } = memStore();
    files.set('ws/prompd.json', JSON.stringify({ name: 'my-proj', type: 'package', dependencies: { '@other/dep': '2.0.0' } }));

    await installPackage({ ref: '@acme/widget', root: 'ws', store, download: async () => buf });

    const manifest = JSON.parse(files.get('ws/prompd.json')!);
    expect(manifest.name).toBe('my-proj');
    expect(manifest.dependencies['@other/dep']).toBe('2.0.0');
    expect(manifest.dependencies['@acme/widget']).toBe('1.0.0');
  });

  it('removes only its own dependency on uninstall', async () => {
    const { store, files } = memStore();
    files.set('ws/prompd.json', JSON.stringify({ dependencies: { '@acme/widget': '1.0.0', '@other/dep': '2.0.0' } }));

    await uninstallPackage({ ref: '@acme/widget', root: 'ws', store });

    const manifest = JSON.parse(files.get('ws/prompd.json')!);
    expect(manifest.dependencies['@acme/widget']).toBeUndefined();
    expect(manifest.dependencies['@other/dep']).toBe('2.0.0');
  });
});
