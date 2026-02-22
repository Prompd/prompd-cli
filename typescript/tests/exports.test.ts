/**
 * Test that all exports are available from the main library entry point
 */

import { describe, it, expect } from '@jest/globals';

describe('Library Exports', () => {
  it('should export MemoryFileSystem', async () => {
    const { MemoryFileSystem } = await import('../src/lib/index');
    expect(MemoryFileSystem).toBeDefined();

    const fs = new MemoryFileSystem();
    expect(fs).toBeDefined();
  });

  it('should export NodeFileSystem', async () => {
    const { NodeFileSystem } = await import('../src/lib/index');
    expect(NodeFileSystem).toBeDefined();

    const fs = new NodeFileSystem();
    expect(fs).toBeDefined();
  });

  it('should export IFileSystem interface type', async () => {
    const { MemoryFileSystem } = await import('../src/lib/index');
    const fs = new MemoryFileSystem();

    // Type check - should satisfy IFileSystem
    expect(typeof fs.exists).toBe('function');
    expect(typeof fs.readFile).toBe('function');
    expect(typeof fs.isDirectory).toBe('function');
    expect(typeof fs.readdir).toBe('function');
    expect(typeof fs.resolve).toBe('function');
    expect(typeof fs.dirname).toBe('function');
    expect(typeof fs.join).toBe('function');
  });

  it('should export getDefaultFileSystem', async () => {
    const { getDefaultFileSystem } = await import('../src/lib/index');
    expect(getDefaultFileSystem).toBeDefined();

    const fs = getDefaultFileSystem();
    expect(fs).toBeDefined();
  });

  it('should export PrompdCompiler', async () => {
    const { PrompdCompiler } = await import('../src/lib/index');
    expect(PrompdCompiler).toBeDefined();

    const compiler = new PrompdCompiler();
    expect(compiler).toBeDefined();
  });

  it('should work together - compiler with MemoryFileSystem', async () => {
    const { PrompdCompiler, MemoryFileSystem } = await import('../src/lib/index');

    const fs = new MemoryFileSystem({
      '/test.prmd': `---
id: test
name: test
version: 1.0.0
---

# User
Hello World
`
    });

    const compiler = new PrompdCompiler();
    const result = await compiler.compile('/test.prmd', {
      fileSystem: fs,
      outputFormat: 'markdown'
    });

    expect(result).toContain('Hello World');
  });
});
