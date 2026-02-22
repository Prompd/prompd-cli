/**
 * Tests for file system abstraction layer
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { MemoryFileSystem, NodeFileSystem } from '../../src/lib/compiler/file-system';

describe('MemoryFileSystem', () => {
  let fs: MemoryFileSystem;

  beforeEach(() => {
    fs = new MemoryFileSystem();
  });

  describe('addFile and readFile', () => {
    it('should store and retrieve a file', () => {
      fs.addFile('/test.txt', 'Hello World');
      expect(fs.readFile('/test.txt')).toBe('Hello World');
    });

    it('should handle files with different paths', () => {
      fs.addFile('/dir/file1.txt', 'Content 1');
      fs.addFile('/dir/file2.txt', 'Content 2');

      expect(fs.readFile('/dir/file1.txt')).toBe('Content 1');
      expect(fs.readFile('/dir/file2.txt')).toBe('Content 2');
    });

    it('should throw error for non-existent file', () => {
      expect(() => fs.readFile('/missing.txt')).toThrow('File not found');
    });

    it('should normalize paths', () => {
      fs.addFile('./test.txt', 'Content');

      expect(fs.readFile('test.txt')).toBe('Content');
      expect(fs.readFile('./test.txt')).toBe('Content');
      expect(fs.readFile('/test.txt')).toBe('Content');
    });

    it('should handle backslashes in paths', () => {
      fs.addFile('dir\\file.txt', 'Content');

      expect(fs.readFile('dir/file.txt')).toBe('Content');
      expect(fs.readFile('dir\\file.txt')).toBe('Content');
    });
  });

  describe('addFiles', () => {
    it('should add multiple files at once', () => {
      fs.addFiles({
        '/file1.txt': 'Content 1',
        '/file2.txt': 'Content 2',
        '/dir/file3.txt': 'Content 3'
      });

      expect(fs.readFile('/file1.txt')).toBe('Content 1');
      expect(fs.readFile('/file2.txt')).toBe('Content 2');
      expect(fs.readFile('/dir/file3.txt')).toBe('Content 3');
    });
  });

  describe('exists', () => {
    beforeEach(() => {
      fs.addFile('/test.txt', 'Content');
      fs.addFile('/dir/nested/file.txt', 'Nested');
    });

    it('should return true for existing files', () => {
      expect(fs.exists('/test.txt')).toBe(true);
      expect(fs.exists('/dir/nested/file.txt')).toBe(true);
    });

    it('should return false for non-existent files', () => {
      expect(fs.exists('/missing.txt')).toBe(false);
      expect(fs.exists('/dir/missing.txt')).toBe(false);
    });

    it('should handle normalized paths', () => {
      expect(fs.exists('test.txt')).toBe(true);
      expect(fs.exists('./test.txt')).toBe(true);
    });
  });

  describe('isDirectory', () => {
    beforeEach(() => {
      fs.addFiles({
        '/dir/file1.txt': 'Content 1',
        '/dir/file2.txt': 'Content 2',
        '/dir/subdir/file3.txt': 'Content 3'
      });
    });

    it('should return true for directories with files', () => {
      expect(fs.isDirectory('/dir')).toBe(true);
      expect(fs.isDirectory('/dir/subdir')).toBe(true);
    });

    it('should return false for files', () => {
      expect(fs.isDirectory('/dir/file1.txt')).toBe(false);
    });

    it('should return false for non-existent directories', () => {
      expect(fs.isDirectory('/missing')).toBe(false);
    });

    it('should handle paths with and without trailing slash', () => {
      expect(fs.isDirectory('/dir')).toBe(true);
      expect(fs.isDirectory('/dir/')).toBe(true);
    });
  });

  describe('readdir', () => {
    beforeEach(() => {
      fs.addFiles({
        '/dir/file1.txt': 'Content 1',
        '/dir/file2.txt': 'Content 2',
        '/dir/subdir/file3.txt': 'Content 3',
        '/dir/subdir/file4.txt': 'Content 4'
      });
    });

    it('should list immediate children only', () => {
      const files = fs.readdir('/dir');

      expect(files).toContain('file1.txt');
      expect(files).toContain('file2.txt');
      expect(files).toContain('subdir');
      expect(files).not.toContain('file3.txt'); // Nested file
    });

    it('should list subdirectory contents', () => {
      const files = fs.readdir('/dir/subdir');

      expect(files).toContain('file3.txt');
      expect(files).toContain('file4.txt');
      expect(files.length).toBe(2);
    });

    it('should return empty array for non-existent directory', () => {
      const files = fs.readdir('/missing');
      expect(files).toEqual([]);
    });

    it('should handle paths with and without trailing slash', () => {
      const files1 = fs.readdir('/dir');
      const files2 = fs.readdir('/dir/');

      expect(files1).toEqual(files2);
    });
  });

  describe('path operations', () => {
    it('should resolve paths', () => {
      expect(fs.resolve('dir', 'file.txt')).toBe('/dir/file.txt');
      expect(fs.resolve('/dir', 'file.txt')).toBe('/dir/file.txt');
    });

    it('should get dirname', () => {
      expect(fs.dirname('/dir/subdir/file.txt')).toBe('/dir/subdir');
      expect(fs.dirname('/dir/file.txt')).toBe('/dir');
      expect(fs.dirname('/file.txt')).toBe('/');
    });

    it('should join paths', () => {
      expect(fs.join('dir', 'file.txt')).toBe('dir/file.txt');
      expect(fs.join('/dir', 'subdir', 'file.txt')).toBe('/dir/subdir/file.txt');
    });
  });

  describe('constructor with initial files', () => {
    it('should initialize with files', () => {
      const fs = new MemoryFileSystem({
        '/file1.txt': 'Content 1',
        '/file2.txt': 'Content 2'
      });

      expect(fs.readFile('/file1.txt')).toBe('Content 1');
      expect(fs.readFile('/file2.txt')).toBe('Content 2');
    });
  });
});

describe('NodeFileSystem', () => {
  const fs = new NodeFileSystem();

  describe('path operations', () => {
    it('should resolve paths using path.resolve', () => {
      const resolved = fs.resolve('test', 'file.txt');
      expect(resolved).toContain('file.txt');
    });

    it('should get dirname using path.dirname', () => {
      const dirname = fs.dirname('/test/file.txt');
      expect(dirname).toBe('/test');
    });

    it('should join paths using path.join', () => {
      const joined = fs.join('dir', 'file.txt');
      expect(joined).toContain('file.txt');
    });
  });

  // Note: Not testing actual file operations with NodeFileSystem
  // as that would require creating/cleaning up real files
});
