/**
 * Tests for in-memory package packing, publishing, and security
 */

import { MemoryFileSystem } from '../../src/lib/compiler/file-system';
import { RegistryClient } from '../../src/lib/registry';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as tar from 'tar';

// Increase timeout for tarball operations
jest.setTimeout(30000);

describe('In-Memory Package Pack, Publish, and Security', () => {
  let memoryFS: MemoryFileSystem;

  beforeEach(() => {
    memoryFS = new MemoryFileSystem();
  });

  describe('Security Validation', () => {
    it('should reject invalid package names', async () => {
      const invalidBuffer = Buffer.from('fake tarball');

      await expect(
        memoryFS.addPackage('../evil', '1.0.0', invalidBuffer)
      ).rejects.toThrow('Invalid package name');
    });

    it('should reject invalid versions', async () => {
      const invalidBuffer = Buffer.from('fake tarball');

      await expect(
        memoryFS.addPackage('@test/pkg', 'not-semver', invalidBuffer)
      ).rejects.toThrow('Invalid version format');
    });

    it('should reject oversized packages', async () => {
      const hugeBuffer = Buffer.alloc(60 * 1024 * 1024); // 60MB (over 50MB limit)

      await expect(
        memoryFS.addPackage('@test/pkg', '1.0.0', hugeBuffer)
      ).rejects.toThrow('Package too large');
    });

    it('should reject corrupt tarballs', async () => {
      const corruptBuffer = Buffer.from('this is not a valid tarball');

      await expect(
        memoryFS.addPackage('@test/corrupt', '1.0.0', corruptBuffer)
      ).rejects.toThrow();
    });
  });

  describe('getAllFiles() and getTotalSize()', () => {
    it('should get all files from memory', () => {
      memoryFS.addFile('/test/file1.prmd', 'content1');
      memoryFS.addFile('/test/file2.prmd', 'content2');
      memoryFS.addFile('/other/file3.prmd', 'content3');

      const allFiles = memoryFS.getAllFiles();
      expect(allFiles.size).toBe(3);
    });

    it('should filter files by base path', () => {
      memoryFS.addFile('test/file1.prmd', 'content1');
      memoryFS.addFile('test/file2.prmd', 'content2');
      memoryFS.addFile('other/file3.prmd', 'content3');

      const testFiles = memoryFS.getAllFiles('test');
      expect(testFiles.size).toBe(2);
    });

    it('should calculate total size correctly', () => {
      memoryFS.addFile('test/file1.prmd', 'Hello');  // 5 bytes
      memoryFS.addFile('test/file2.prmd', 'World!'); // 6 bytes

      const stats = memoryFS.getTotalSize('test');
      expect(stats.size).toBe(11);
      expect(stats.files).toBe(2);
    });
  });

  describe('createPackageBuffer()', () => {
    it('should create package buffer from memory', async () => {
      // Add files to memory
      memoryFS.addFile('pkg/prompts/main.prmd', '# Main prompt');
      memoryFS.addFile('pkg/README.md', '# Package');

      const manifest = {
        name: '@test/my-package',
        version: '1.0.0',
        description: 'Test package',
        author: 'Test'
      };

      const buffer = await memoryFS.createPackageBuffer('pkg', manifest);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should include manifest.json in package', async () => {
      memoryFS.addFile('pkg/test.prmd', '# Test');

      const manifest = {
        name: '@test/pkg',
        version: '1.0.0',
        description: 'Test',
        author: 'Test'
      };

      const buffer = await memoryFS.createPackageBuffer('pkg', manifest);

      // Extract and verify manifest is present
      const tempDir = await fs.mkdtemp(path.join(require('os').tmpdir(), 'test-'));
      try {
        const tarPath = path.join(tempDir, 'test.tar.gz');
        await fs.writeFile(tarPath, buffer);

        await tar.x({ file: tarPath, cwd: tempDir });

        const manifestExists = await fs.pathExists(path.join(tempDir, 'package', 'manifest.json'));
        expect(manifestExists).toBe(true);
      } finally {
        await fs.remove(tempDir);
      }
    });

    it('should reject packages with missing required manifest fields', async () => {
      memoryFS.addFile('pkg/test.prmd', '# Test');

      const invalidManifest = {
        name: '@test/pkg',
        version: '1.0.0'
        // missing description and author
      };

      await expect(
        memoryFS.createPackageBuffer('pkg', invalidManifest)
      ).rejects.toThrow('missing required fields');
    });

    it('should apply file filters', async () => {
      memoryFS.addFile('pkg/include.prmd', '# Include');
      memoryFS.addFile('pkg/exclude.txt', 'Exclude');

      const manifest = {
        name: '@test/pkg',
        version: '1.0.0',
        description: 'Test',
        author: 'Test'
      };

      const buffer = await memoryFS.createPackageBuffer('pkg', manifest, {
        filter: (filePath: string) => filePath.endsWith('.prmd')
      });

      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe('Pack Operation Integration', () => {
    it('should complete full pack workflow', async () => {
      // Setup package in memory
      memoryFS.addFile('mypackage/prompts/greeting.prmd', `---
name: greeting
version: 1.0.0
---
# User
Hello!`);

      const manifest = {
        name: '@test/greeting-pkg',
        version: '1.0.0',
        description: 'Greeting package',
        author: 'Test Author',
        license: 'MIT'
      };

      // Create package buffer
      const buffer = await memoryFS.createPackageBuffer('mypackage', manifest);

      // Verify we can extract it
      const tempDir = await fs.mkdtemp(path.join(require('os').tmpdir(), 'pack-test-'));
      try {
        const tarPath = path.join(tempDir, 'package.tar.gz');
        await fs.writeFile(tarPath, buffer);

        await tar.x({ file: tarPath, cwd: tempDir, strip: 1 });

        const prmdExists = await fs.pathExists(path.join(tempDir, 'prompts', 'greeting.prmd'));
        const manifestExists = await fs.pathExists(path.join(tempDir, 'manifest.json'));

        expect(prmdExists).toBe(true);
        expect(manifestExists).toBe(true);
      } finally {
        await fs.remove(tempDir);
      }
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain compatibility with existing tests', async () => {
      // Existing in-memory package tests should still work
      const testFiles: Record<string, string> = {
        'package/test.prmd': '---\\nname: test\\nversion: 1.0.0\\n---\\n# Test'
      };

      const tarballBuffer = await createTarball(testFiles);
      await memoryFS.addPackage('@test/compat', '1.0.0', tarballBuffer);

      const packagePath = memoryFS.getPackagePath('@test/compat', '1.0.0');
      expect(memoryFS.exists(`${packagePath}/test.prmd`)).toBe(true);
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
    await tar.create({
      file: tarballPath,
      cwd: tempDir
    }, ['package']);

    // Read tarball as buffer
    const buffer = await fs.readFile(tarballPath);
    return buffer;
  } finally {
    // Cleanup
    await fs.remove(tempDir);
  }
}
