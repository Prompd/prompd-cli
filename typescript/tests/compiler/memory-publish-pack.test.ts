/**
 * Tests for in-memory package packing, publishing, and security
 */

import { MemoryFileSystem } from '../../src/lib/compiler/file-system';
import { RegistryClient } from '../../src/lib/registry';
import * as fs from 'fs-extra';
import * as path from 'path';
import AdmZip from 'adm-zip';

// Increase timeout for zip operations
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

      // Extract and verify manifest is present (ZIP format)
      const zip = new AdmZip(buffer);
      const manifestEntry = zip.getEntry('manifest.json');
      expect(manifestEntry).not.toBeNull();

      const manifestContent = JSON.parse(manifestEntry!.getData().toString('utf8'));
      expect(manifestContent.name).toBe('@test/pkg');
      expect(manifestContent.version).toBe('1.0.0');
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

      // Verify we can extract it (ZIP format)
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries().map(e => e.entryName);

      expect(entries).toContain('manifest.json');
      expect(entries.some(e => e.includes('greeting.prmd'))).toBe(true);
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain compatibility with existing tests', async () => {
      // Create a valid ZIP package for addPackage
      const testBuffer = createZipPackage({
        'test.prmd': '---\nname: test\nversion: 1.0.0\n---\n# Test'
      });

      await memoryFS.addPackage('@test/compat', '1.0.0', testBuffer);

      const packagePath = memoryFS.getPackagePath('@test/compat', '1.0.0');
      expect(memoryFS.exists(`${packagePath}/test.prmd`)).toBe(true);
    });
  });
});

/**
 * Helper function to create a ZIP package buffer from a file map.
 * Uses AdmZip to match the .pdpkg format expected by MemoryFileSystem.addPackage.
 */
function createZipPackage(files: Record<string, string>): Buffer {
  const zip = new AdmZip();

  for (const [filePath, content] of Object.entries(files)) {
    zip.addFile(filePath, Buffer.from(content, 'utf-8'));
  }

  return zip.toBuffer();
}
