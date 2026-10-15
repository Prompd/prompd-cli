import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { openPdpkg } from '@prompd/core';
import { buildPackageBytes, DEFAULT_EXCLUSIONS } from '../src/commands/package';
import { MemoryFileSystem } from '../src/lib/compiler/file-system';

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

  it('MemoryFileSystem.createPackageBuffer writes prompd.json with integrity', async () => {
    const mem = new MemoryFileSystem();
    mem.addFile('/pkg/a.prmd', '---\nid: a\n---\nhi');
    const buf = await mem.createPackageBuffer('/pkg', { name: '@t/m', version: '1.0.0', description: 'd' });
    const pkg = await openPdpkg(new Uint8Array(buf));
    expect([...pkg.files.keys()]).toEqual(['a.prmd']);
  });

  it('MemoryFileSystem.addPackage goes through core: a package without integrity is refused', async () => {
    const mem = new MemoryFileSystem();
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addFile('a.md', Buffer.from('x'));
    zip.addFile('prompd.json', Buffer.from(JSON.stringify({ name: '@t/n', version: '1.0.0', type: 'package' })));
    await expect(mem.addPackage('@t/n', '1.0.0', zip.toBuffer())).rejects.toMatchObject({ code: 'INTEGRITY_MISSING' });
  });
});
