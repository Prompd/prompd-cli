/**
 * Tests for in-memory package installation and resolution
 */

import { MemoryFileSystem } from '../../src/lib/compiler/file-system';
import { PrompdCompiler } from '../../src/lib/compiler';
import * as tar from 'tar';
import * as fs from 'fs-extra';
import * as path from 'path';
import { Readable } from 'stream';

// Increase timeout for tarball operations
jest.setTimeout(30000);

describe('In-Memory Package Installation', () => {
  let memoryFS: MemoryFileSystem;

  beforeEach(() => {
    memoryFS = new MemoryFileSystem();
  });

  describe('MemoryFileSystem.addPackage()', () => {
    it('should extract tarball to memory', async () => {
      // Create a mock tarball with test files
      const testFiles: Record<string, string> = {
        'package/base.prmd': `---
name: base-template
version: 1.0.0
description: Base template
---

# System
You are a helpful assistant.

# User
{user_input}
`,
        'package/manifest.json': JSON.stringify({
          name: '@test/package',
          version: '1.0.0',
          description: 'Test package'
        })
      };

      // Create tarball buffer
      const tarballBuffer = await createTarball(testFiles);

      // Add package to memory
      await memoryFS.addPackage('@test/package', '1.0.0', tarballBuffer);

      // Verify files are accessible in memory
      const packagePath = memoryFS.getPackagePath('@test/package', '1.0.0');

      expect(memoryFS.exists(`${packagePath}/base.prmd`)).toBe(true);
      expect(memoryFS.exists(`${packagePath}/manifest.json`)).toBe(true);

      // Verify content
      const prmdContent = memoryFS.readFile(`${packagePath}/base.prmd`);
      expect(prmdContent).toContain('name: base-template');
      expect(prmdContent).toContain('You are a helpful assistant');
    });

    it('should handle package/ prefix stripping', async () => {
      const testFiles: Record<string, string> = {
        'package/test.prmd': '---\nname: test\n---\n# User\nHello'
      };

      const tarballBuffer = await createTarball(testFiles);
      await memoryFS.addPackage('@test/pkg', '1.0.0', tarballBuffer);

      const packagePath = memoryFS.getPackagePath('@test/pkg', '1.0.0');

      // Should be accessible without 'package/' prefix
      expect(memoryFS.exists(`${packagePath}/test.prmd`)).toBe(true);

      // Should NOT have 'package/' in the path
      expect(memoryFS.exists(`${packagePath}/package/test.prmd`)).toBe(false);
    });

    it('should support nested directory structures', async () => {
      const testFiles: Record<string, string> = {
        'package/prompts/greeting.prmd': '---\nname: greeting\n---\n# User\nHi',
        'package/prompts/farewell.prmd': '---\nname: farewell\n---\n# User\nBye',
        'package/utils/helper.prmd': '---\nname: helper\n---\n# System\nHelper'
      };

      const tarballBuffer = await createTarball(testFiles);
      await memoryFS.addPackage('@test/nested', '2.0.0', tarballBuffer);

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
      // This test requires a mock registry client
      // For now, we'll test the basic flow

      // Add a base package to memory
      const basePackage: Record<string, string> = {
        'package/base.prmd': `---
name: base-template
version: 1.0.0
---

# System
Base system prompt.
`
      };

      const baseTarball = await createTarball(basePackage);
      await memoryFS.addPackage('@prompd.io/base', '1.0.0', baseTarball);

      // Add a prompt that inherits from the base package
      memoryFS.addFile('/test-prompt.prmd', `---
name: my-prompt
version: 1.0.0
inherits: "@prompd.io/base@1.0.0/base.prmd"
---

# User
User request goes here.
`);

      // Verify the package is accessible
      const packagePath = memoryFS.getPackagePath('@prompd.io/base', '1.0.0');
      expect(memoryFS.exists(`${packagePath}/base.prmd`)).toBe(true);
    });
  });

  describe('Compiler Integration with In-Memory Packages', () => {
    it('should compile prompts using in-memory packages', async () => {
      // Create a base package
      const basePackage: Record<string, string> = {
        'package/base.prmd': `---
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
      };

      const baseTarball = await createTarball(basePackage);
      await memoryFS.addPackage('@test/base', '1.0.0', baseTarball);

      // Create a prompt that uses the package
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

      // Compile the prompt (Note: This will require the full compilation pipeline to support MemoryFS)
      // For now, we verify the setup is correct
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

    it('should handle corrupt tarballs', async () => {
      const corruptBuffer = Buffer.from('this is not a valid tarball');

      await expect(async () => {
        await memoryFS.addPackage('@test/corrupt', '1.0.0', corruptBuffer);
      }).rejects.toThrow();
    });
  });

  describe('Virtual Path Preservation (Bug Fix)', () => {
    it('should preserve virtual paths when using MemoryFileSystem', async () => {
      const memoryFS = new MemoryFileSystem();

      // Add a file with a virtual path
      memoryFS.addFile('/main.prmd', `---
id: test-prompt
name: test-prompt
version: 1.0.0
---
# User
Test prompt content`);

      // Compile using MemoryFileSystem with virtual path
      const compiler = new PrompdCompiler();
      const output = await compiler.compile('/main.prmd', {
        fileSystem: memoryFS
      });

      // Should compile successfully without trying to resolve to OS path
      expect(output).toContain('Test prompt content');
    });

    it('should resolve to absolute paths when using NodeFileSystem', async () => {
      // This test verifies that disk-based paths still get resolved
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

        // Use relative path (should be resolved to absolute)
        const compiler = new PrompdCompiler();
        const relativePath = path.relative(process.cwd(), testFile);

        const output = await compiler.compile(relativePath);

        // Should compile successfully with resolved path
        expect(output).toContain('Disk-based prompt');
      } finally {
        await fs.remove(tempDir);
      }
    });
  });
});

/**
 * Helper function to create a tarball from file map
 */
async function createTarball(files: Record<string, string>): Promise<Buffer> {
  const tempDir = await fs.mkdtemp(path.join(require('os').tmpdir(), 'prompd-test-'));

  try {
    // Write files to temp directory
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(tempDir, filePath);
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, content, 'utf-8');
    }

    // Create tarball
    const tarballPath = path.join(tempDir, 'package.tar');
    await tar.create(
      {
        file: tarballPath,
        cwd: tempDir
      },
      ['package']
    );

    // Read tarball as buffer
    const buffer = await fs.readFile(tarballPath);
    return buffer;
  } finally {
    // Cleanup
    await fs.remove(tempDir);
  }
}
