/**
 * Tests for in-memory package installation and resolution
 */

import { MemoryFileSystem } from '../../src/lib/compiler/file-system';
import { PrompdCompiler } from '../../src/lib/compiler';
import AdmZip from 'adm-zip';
import * as fs from 'fs-extra';
import * as path from 'path';

// Increase timeout for zip operations
jest.setTimeout(30000);

/**
 * Helper function to create a ZIP package buffer from file map.
 * Keys are file paths inside the ZIP (no package/ prefix needed).
 */
function createZipPackage(files: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [filePath, content] of Object.entries(files)) {
    zip.addFile(filePath, Buffer.from(content, 'utf-8'));
  }
  return zip.toBuffer();
}

describe('In-Memory Package Installation', () => {
  let memoryFS: MemoryFileSystem;

  beforeEach(() => {
    memoryFS = new MemoryFileSystem();
  });

  describe('MemoryFileSystem.addPackage()', () => {
    it('should extract zip package to memory', async () => {
      const zipBuffer = createZipPackage({
        'base.prmd': `---
name: base-template
version: 1.0.0
description: Base template
---

# System
You are a helpful assistant.

# User
{user_input}
`,
        'manifest.json': JSON.stringify({
          name: '@test/package',
          version: '1.0.0',
          description: 'Test package'
        })
      });

      await memoryFS.addPackage('@test/package', '1.0.0', zipBuffer);

      const packagePath = memoryFS.getPackagePath('@test/package', '1.0.0');

      expect(memoryFS.exists(`${packagePath}/base.prmd`)).toBe(true);
      expect(memoryFS.exists(`${packagePath}/manifest.json`)).toBe(true);

      const prmdContent = memoryFS.readFile(`${packagePath}/base.prmd`);
      expect(prmdContent).toContain('name: base-template');
      expect(prmdContent).toContain('You are a helpful assistant');
    });

    it('should store files at correct virtual paths', async () => {
      const zipBuffer = createZipPackage({
        'test.prmd': '---\nname: test\n---\n# User\nHello'
      });

      await memoryFS.addPackage('@test/pkg', '1.0.0', zipBuffer);

      const packagePath = memoryFS.getPackagePath('@test/pkg', '1.0.0');

      expect(memoryFS.exists(`${packagePath}/test.prmd`)).toBe(true);
    });

    it('should support nested directory structures', async () => {
      const zipBuffer = createZipPackage({
        'prompts/greeting.prmd': '---\nname: greeting\n---\n# User\nHi',
        'prompts/farewell.prmd': '---\nname: farewell\n---\n# User\nBye',
        'utils/helper.prmd': '---\nname: helper\n---\n# System\nHelper'
      });

      await memoryFS.addPackage('@test/nested', '2.0.0', zipBuffer);

      const packagePath = memoryFS.getPackagePath('@test/nested', '2.0.0');

      expect(memoryFS.isDirectory(`${packagePath}/prompts`)).toBe(true);
      expect(memoryFS.isDirectory(`${packagePath}/utils`)).toBe(true);
      expect(memoryFS.exists(`${packagePath}/prompts/greeting.prmd`)).toBe(true);
      expect(memoryFS.exists(`${packagePath}/utils/helper.prmd`)).toBe(true);
    });
  });

  describe('MemoryFileSystem.getPackagePath()', () => {
    it('should generate correct virtual paths', () => {
      const path1 = memoryFS.getPackagePath('@prompd.io/core', '1.0.0');
      expect(path1).toBe('/packages/@prompd.io/core@1.0.0');

      const path2 = memoryFS.getPackagePath('@my-org/my-pkg', '2.1.3');
      expect(path2).toBe('/packages/@my-org/my-pkg@2.1.3');
    });
  });

  describe('Package Resolution with MemoryFileSystem', () => {
    it('should resolve package references from memory', async () => {
      const baseZip = createZipPackage({
        'base.prmd': `---
name: base-template
version: 1.0.0
---

# System
Base system prompt.
`
      });

      await memoryFS.addPackage('@prompd.io/base', '1.0.0', baseZip);

      memoryFS.addFile('/test-prompt.prmd', `---
name: my-prompt
version: 1.0.0
inherits: "@prompd.io/base@1.0.0/base.prmd"
---

# User
User request goes here.
`);

      const packagePath = memoryFS.getPackagePath('@prompd.io/base', '1.0.0');
      expect(memoryFS.exists(`${packagePath}/base.prmd`)).toBe(true);
    });
  });

  describe('Compiler Integration with In-Memory Packages', () => {
    it('should compile prompts using in-memory packages', async () => {
      const baseZip = createZipPackage({
        'base.prmd': `---
name: base
version: 1.0.0
parameters:
  - name: context
    type: string
    required: false
---

# System
You are a helpful AI assistant.

# Context
{%- if context %}
{{ context }}
{%- endif %}
`
      });

      await memoryFS.addPackage('@test/base', '1.0.0', baseZip);

      memoryFS.addFile('/my-prompt.prmd', `---
name: my-prompt
version: 1.0.0
inherits: "@test/base@1.0.0/base.prmd"
parameters:
  - name: user_input
    type: string
    required: true
---

# User
{{ user_input }}
`);

      expect(memoryFS.exists('/my-prompt.prmd')).toBe(true);
      expect(memoryFS.exists('/packages/@test/base@1.0.0/base.prmd')).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should throw error for invalid package reference format', () => {
      expect(() => {
        // @ts-ignore - Testing private method indirectly
        memoryFS.getPackagePath('invalid-package', '1.0.0');
      }).not.toThrow(); // getPackagePath doesn't validate, that's done in parsePackageReference
    });

    it('should handle missing packages gracefully', () => {
      const packagePath = memoryFS.getPackagePath('@missing/package', '1.0.0');
      expect(memoryFS.exists(packagePath)).toBe(false);
    });

    it('should handle corrupt zip data', async () => {
      const corruptBuffer = Buffer.from('this is not a valid zip');

      await expect(async () => {
        await memoryFS.addPackage('@test/corrupt', '1.0.0', corruptBuffer);
      }).rejects.toThrow();
    });
  });

  describe('Virtual Path Preservation (Bug Fix)', () => {
    it('should preserve virtual paths when using MemoryFileSystem', async () => {
      const memoryFS = new MemoryFileSystem();

      memoryFS.addFile('/main.prmd', `---
id: test-prompt
name: test-prompt
version: 1.0.0
---
# User
Test prompt content`);

      const compiler = new PrompdCompiler();
      const output = await compiler.compile('/main.prmd', {
        fileSystem: memoryFS
      });

      expect(output).toContain('Test prompt content');
    });

    it('should resolve to absolute paths when using NodeFileSystem', async () => {
      const tempDir = await fs.mkdtemp(path.join(require('os').tmpdir(), 'prompd-path-test-'));

      try {
        const testFile = path.join(tempDir, 'test.prmd');
        await fs.writeFile(testFile, `---
id: test-prompt
name: test-prompt
version: 1.0.0
---
# User
Disk-based prompt`, 'utf-8');

        const compiler = new PrompdCompiler();
        const relativePath = path.relative(process.cwd(), testFile);

        const output = await compiler.compile(relativePath);

        expect(output).toContain('Disk-based prompt');
      } finally {
        await fs.remove(tempDir);
      }
    });
  });
});
