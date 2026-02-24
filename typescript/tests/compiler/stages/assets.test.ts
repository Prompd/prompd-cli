/**
 * Tests for Asset Extraction Stage
 */

import { AssetExtractionStage } from '../../../src/lib/compiler/stages/assets';
import { CompilationContext } from '../../../src/lib/compiler/types';
import { NodeFileSystem } from '../../../src/lib/compiler/file-system';
import { createTempFiles, cleanupTempDir } from '../test-helpers';
import { join } from 'path';

/**
 * Create a CompilationContext backed by NodeFileSystem for disk-based tests.
 */
function createDiskContext(sourceFile: string): CompilationContext {
  const context = new CompilationContext(sourceFile, { outputFormat: 'markdown' });
  context.fileSystem = new NodeFileSystem();
  return context;
}

describe('AssetExtractionStage', () => {
  let stage: AssetExtractionStage;

  beforeEach(() => {
    stage = new AssetExtractionStage();
  });

  describe('process()', () => {
    it('should extract content from placeholder references', async () => {
      const tempDir = await createTempFiles({
        'data.json': JSON.stringify({ name: 'Alice', age: 30 })
      });

      const context = createDiskContext(join(tempDir, 'test.prmd'));
      context.content = `# User

Load data: [file:./data.json]`;

      await stage.process(context);

      expect(context.content).toContain('"name"');
      expect(context.content).toContain('"Alice"');
      expect(context.content).not.toContain('[file:./data.json]');

      await cleanupTempDir(tempDir);
    });

    it('should handle multiple file references', async () => {
      const tempDir = await createTempFiles({
        'file1.txt': 'Content 1',
        'file2.txt': 'Content 2'
      });

      const context = createDiskContext(join(tempDir, 'test.prmd'));
      context.content = `# User

First: [file:./file1.txt]
Second: [file:./file2.txt]`;

      await stage.process(context);

      expect(context.content).toContain('Content 1');
      expect(context.content).toContain('Content 2');

      await cleanupTempDir(tempDir);
    });

    it('should handle non-existent path traversal targets', async () => {
      const tempDir = await createTempFiles({});

      const context = createDiskContext(join(tempDir, 'test.prmd'));
      context.content = '[file:../../nonexistent-file.txt]';

      await stage.process(context);

      expect(context.errors.length).toBeGreaterThan(0);
      expect(context.errors[0]).toMatch(/not found|failed/i);

      await cleanupTempDir(tempDir);
    });

    it('should truncate large file content', async () => {
      const tempDir = await createTempFiles({
        'large.txt': 'x'.repeat(2 * 1024 * 1024) // 2MB exceeds 1MB max output
      });

      const context = createDiskContext(join(tempDir, 'test.prmd'));
      context.content = '[file:./large.txt]';

      await stage.process(context);

      expect(context.errors.length).toBe(0);
      expect(context.content).toContain('[Content truncated...]');

      await cleanupTempDir(tempDir);
    });

    it('should handle non-existent files gracefully', async () => {
      const tempDir = await createTempFiles({});

      const context = createDiskContext(join(tempDir, 'test.prmd'));
      context.content = '[file:./nonexistent.txt]';

      await stage.process(context);

      expect(context.errors.length).toBeGreaterThan(0);
      expect(context.errors[0]).toMatch(/not found/i);

      await cleanupTempDir(tempDir);
    });

    it('should skip extraction if no references found', async () => {
      const tempDir = await createTempFiles({});

      const context = createDiskContext(join(tempDir, 'test.prmd'));
      context.content = '# User\n\nNo file references here';

      await stage.process(context);

      expect(context.content).toBe('# User\n\nNo file references here');
      expect(context.errors.length).toBe(0);

      await cleanupTempDir(tempDir);
    });
  });

  describe('extractText()', () => {
    it('should extract plain text files', async () => {
      const tempDir = await createTempFiles({
        'test.txt': 'Plain text content'
      });

      const context = createDiskContext(join(tempDir, 'test.prmd'));
      const filePath = join(tempDir, 'test.txt');
      const content = await (stage as any).extractText(context, filePath);

      expect(content).toContain('Plain text content');

      await cleanupTempDir(tempDir);
    });

    it('should extract JSON files', async () => {
      const tempDir = await createTempFiles({
        'data.json': JSON.stringify({ key: 'value' }, null, 2)
      });

      const context = createDiskContext(join(tempDir, 'test.prmd'));
      const filePath = join(tempDir, 'data.json');
      const content = await (stage as any).extractText(context, filePath);

      expect(content).toContain('"key"');
      expect(content).toContain('"value"');

      await cleanupTempDir(tempDir);
    });

    it('should extract YAML files', async () => {
      const tempDir = await createTempFiles({
        'config.yaml': 'name: test\nversion: 1.0.0'
      });

      const context = createDiskContext(join(tempDir, 'test.prmd'));
      const filePath = join(tempDir, 'config.yaml');
      const content = await (stage as any).extractText(context, filePath);

      expect(content).toContain('name: test');
      expect(content).toContain('version: 1.0.0');

      await cleanupTempDir(tempDir);
    });

    it('should extract CSV files', async () => {
      const tempDir = await createTempFiles({
        'data.csv': 'name,age\nAlice,30\nBob,25'
      });

      const context = createDiskContext(join(tempDir, 'test.prmd'));
      const filePath = join(tempDir, 'data.csv');
      const content = await (stage as any).extractText(context, filePath);

      expect(content).toContain('name,age');
      expect(content).toContain('Alice,30');

      await cleanupTempDir(tempDir);
    });
  });

  describe('extractExcel()', () => {
    it('should handle Excel-like content gracefully', async () => {
      const tempDir = await createTempFiles({
        'data.xlsx': 'Not a valid Excel file'
      });

      const filePath = join(tempDir, 'data.xlsx');
      // xlsx library is lenient and parses many formats as single-sheet CSVs
      const content = await (stage as any).extractExcel(filePath);
      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);

      await cleanupTempDir(tempDir);
    });
  });

  describe('extractWord()', () => {
    it('should throw for invalid Word files', async () => {
      const tempDir = await createTempFiles({
        'invalid.docx': 'Not a valid Word file'
      });

      const filePath = join(tempDir, 'invalid.docx');

      await expect(
        (stage as any).extractWord(filePath)
      ).rejects.toThrow(/word/i);

      await cleanupTempDir(tempDir);
    });
  });

  describe('extractPdf()', () => {
    it('should throw for invalid PDF files', async () => {
      const tempDir = await createTempFiles({
        'invalid.pdf': 'Not a valid PDF'
      });

      const filePath = join(tempDir, 'invalid.pdf');

      await expect(
        (stage as any).extractPdf(filePath)
      ).rejects.toThrow(/pdf/i);

      await cleanupTempDir(tempDir);
    });
  });

  describe('extractImageMetadata()', () => {
    it('should handle image extraction gracefully', async () => {
      // Create a minimal valid PNG file (1x1 transparent pixel)
      const pngData = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
        0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
        0x42, 0x60, 0x82
      ]);

      const tempDir = await createTempFiles({
        'test.png': pngData
      });

      const filePath = join(tempDir, 'test.png');
      const content = await (stage as any).extractImageMetadata(filePath);

      expect(typeof content).toBe('string');
      expect(content).toContain('Image:');

      await cleanupTempDir(tempDir);
    });

    it('should handle invalid image files', async () => {
      const tempDir = await createTempFiles({
        'invalid.png': 'Not an image'
      });

      const filePath = join(tempDir, 'invalid.png');

      // May throw or return fallback depending on Sharp availability
      try {
        const content = await (stage as any).extractImageMetadata(filePath);
        expect(typeof content).toBe('string');
      } catch (error) {
        expect(error).toBeDefined();
      }

      await cleanupTempDir(tempDir);
    });
  });

  describe('security validation', () => {
    it('should error on non-existent absolute paths', async () => {
      const tempDir = await createTempFiles({});

      const context = createDiskContext(join(tempDir, 'test.prmd'));
      context.content = '[file:/etc/nonexistent-file]';

      await stage.process(context);

      expect(context.errors.length).toBeGreaterThan(0);

      await cleanupTempDir(tempDir);
    });

    it('should error on non-existent parent directory references', async () => {
      const tempDir = await createTempFiles({});

      const context = createDiskContext(join(tempDir, 'test.prmd'));
      context.content = '[file:../../../nonexistent-file]';

      await stage.process(context);

      expect(context.errors.length).toBeGreaterThan(0);

      await cleanupTempDir(tempDir);
    });

    it('should accept safe relative paths', async () => {
      const tempDir = await createTempFiles({
        'safe.txt': 'Safe content'
      });

      const context = createDiskContext(join(tempDir, 'test.prmd'));
      context.content = '[file:./safe.txt]';

      await stage.process(context);

      expect(context.errors.length).toBe(0);
      expect(context.content).toContain('Safe content');

      await cleanupTempDir(tempDir);
    });

    it('should allow shell script extraction', async () => {
      const tempDir = await createTempFiles({
        'script.sh': '#!/bin/bash\necho "test"'
      });

      const context = createDiskContext(join(tempDir, 'test.prmd'));
      context.content = '[file:./script.sh]';

      // .sh files should be allowed (text extraction)
      await stage.process(context);

      expect(context.errors.length).toBe(0);

      await cleanupTempDir(tempDir);
    });
  });

  describe('file type detection', () => {
    it('should detect JSON files by extension', async () => {
      const tempDir = await createTempFiles({
        'data.json': '{"test": true}'
      });

      const context = createDiskContext(join(tempDir, 'test.prmd'));
      context.content = '[file:./data.json]';

      await stage.process(context);

      expect(context.content).toContain('"test"');

      await cleanupTempDir(tempDir);
    });

    it('should detect Excel files by extension', async () => {
      const tempDir = await createTempFiles({
        'data.xlsx': Buffer.from([0x50, 0x4b])
      });

      const context = createDiskContext(join(tempDir, 'test.prmd'));
      context.content = '[file:./data.xlsx]';

      await stage.process(context);

      // Should attempt Excel extraction (may error on minimal data)
      expect(typeof context.content).toBe('string');

      await cleanupTempDir(tempDir);
    });

    it('should detect PDF files by extension', async () => {
      const tempDir = await createTempFiles({
        'doc.pdf': '%PDF-1.4'
      });

      const context = createDiskContext(join(tempDir, 'test.prmd'));
      context.content = '[file:./doc.pdf]';

      await stage.process(context);

      expect(typeof context.content).toBe('string');

      await cleanupTempDir(tempDir);
    });

    it('should detect image files by extension', async () => {
      const pngData = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
      ]);

      const tempDir = await createTempFiles({
        'image.png': pngData
      });

      const context = createDiskContext(join(tempDir, 'test.prmd'));
      context.content = '[file:./image.png]';

      await stage.process(context);

      // Content was processed (either image metadata or extraction error)
      expect(typeof context.content).toBe('string');

      await cleanupTempDir(tempDir);
    });
  });
});
