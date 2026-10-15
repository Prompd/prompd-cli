import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import AdmZip from 'adm-zip';
import { openPdpkg } from '@prompd/core';
import { buildPackageBytes, DEFAULT_EXCLUSIONS } from '../src/commands/package';
import { MemoryFileSystem, NodeFileSystem, IFileSystem } from '../src/lib/compiler/file-system';
import { RegistryClient, PackageMetadata } from '../src/lib/registry';

describe('CLI packers write verifiable packages', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prompd-pack-')); });
  afterEach(async () => { await fs.remove(tmp); });

  it('buildPackageBytes: every file listed and hashed, the source prompd.json is the manifest, not an entry', async () => {
    await fs.outputFile(path.join(tmp, 'prompts', 'a.prmd'), '---\nid: a\n---\nhi');
    await fs.outputFile(path.join(tmp, 'README.md'), '# r');
    await fs.outputJson(path.join(tmp, 'prompd.json'), { name: '@t/p', version: '1.0.0', dependencies: { '@t/dep': '^1.0.0' } });
    const bytes = await buildPackageBytes(tmp, { name: '@t/p', version: '1.0.0', description: 'd', type: 'package' }, DEFAULT_EXCLUSIONS);
    const pkg = await openPdpkg(bytes);
    expect([...pkg.files.keys()].sort()).toEqual(['README.md', 'prompts/a.prmd']);
    expect(pkg.manifest.dependencies).toEqual({ '@t/dep': '^1.0.0' });
  });

  it('buildPackageBytes refuses an agent that references an undeclared skill', async () => {
    await fs.outputFile(path.join(tmp, 'AGENT.md'), '---\nname: a\n---\nx');
    await fs.outputFile(path.join(tmp, 'SOUL.md'), 's');
    await fs.outputFile(path.join(tmp, 'PERSONA.md'), 'p');
    await fs.outputFile(path.join(tmp, 'POLICY.yaml'), 'skills: [secret]\n');
    await expect(buildPackageBytes(tmp, { name: '@t/a', version: '1.0.0', description: 'd', type: 'agent' }, DEFAULT_EXCLUSIONS))
      .rejects.toThrow(/secret/);
  });

  it('buildPackageBytes applies the filter and skips the root manifests in any case', async () => {
    await fs.outputFile(path.join(tmp, 'a.prmd'), '---\nid: a\n---\nhi');
    await fs.outputFile(path.join(tmp, 'notes.txt'), 'n');
    await fs.outputJson(path.join(tmp, 'Prompd.JSON'), { name: '@t/p', version: '1.0.0' });
    const bytes = await buildPackageBytes(tmp, { name: '@t/p', version: '1.0.0', description: 'd', type: 'package' }, DEFAULT_EXCLUSIONS, (p) => p.endsWith('.prmd'));
    expect([...(await openPdpkg(bytes)).files.keys()]).toEqual(['a.prmd']);
  });

  it('disk publish packs only files matching metadata.files, never dist, *.pdpkg or .prompd', async () => {
    await fs.outputFile(path.join(tmp, 'a.prmd'), '---\nid: a\n---\nhi');
    await fs.outputFile(path.join(tmp, 'sub', 'b.prmd'), '---\nid: b\n---\nhi');
    await fs.outputFile(path.join(tmp, 'secret.txt'), 'not matched');
    await fs.outputFile(path.join(tmp, 'dist', 'x.pdpkg'), 'zip');
    await fs.outputFile(path.join(tmp, 'dist', 'c.prmd'), '---\nid: c\n---\nhi');
    await fs.outputFile(path.join(tmp, '.prompd', 'packages', 'd.prmd'), '---\nid: d\n---\nhi');
    await fs.outputFile(path.join(tmp, 'old.pdpkg'), 'zip');
    const client = new RegistryClient({ registryUrl: 'http://127.0.0.1:1', cacheDir: path.join(tmp, '..', 'prompd-cache-unused') });
    const seam = client as unknown as {
      createPackageTarballBuffer(p: string, m: PackageMetadata, f: IFileSystem): Promise<Buffer>;
    };
    const metadata = { name: '@t/p', version: '1.0.0', description: 'd', author: 'a', type: 'package', files: ['*.prmd', '**/*.prmd'] } as unknown as PackageMetadata;
    const buf = await seam.createPackageTarballBuffer(tmp, metadata, new NodeFileSystem());
    const keys = [...(await openPdpkg(new Uint8Array(buf))).files.keys()].sort();
    expect(keys).toEqual(['a.prmd', 'sub/b.prmd']);
  });

  it('MemoryFileSystem.createPackageBuffer writes prompd.json with integrity', async () => {
    const mem = new MemoryFileSystem();
    mem.addFile('/pkg/a.prmd', '---\nid: a\n---\nhi');
    const buf = await mem.createPackageBuffer('/pkg', { name: '@t/m', version: '1.0.0', description: 'd' });
    const pkg = await openPdpkg(new Uint8Array(buf));
    expect([...pkg.files.keys()]).toEqual(['a.prmd']);
  });

  it('MemoryFileSystem.addPackage goes through core: a package without integrity is refused', async () => {
    const mem = new MemoryFileSystem();
    const zip = new AdmZip();
    zip.addFile('a.md', Buffer.from('x'));
    zip.addFile('prompd.json', Buffer.from(JSON.stringify({ name: '@t/n', version: '1.0.0', type: 'package' })));
    await expect(mem.addPackage('@t/n', '1.0.0', zip.toBuffer())).rejects.toMatchObject({ code: 'INTEGRITY_MISSING' });
  });
});
