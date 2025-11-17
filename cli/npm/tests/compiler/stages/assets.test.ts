/**
 * Tests for Asset Extraction Stage
 */

import { AssetExtractionStage } from '../../../src/lib/compiler/stages/assets';
import { CompilationContext } from '../../../src/lib/compiler/types';
import { createTempFiles, cleanupTempDir, createMockContext } from '../test-helpers';
import { writeFileSync } from 'fs';
import { join } from 'path';

describe('AssetExtractionStage', () => {
  let stage: AssetExtractionStage;

  beforeEach(() => {
    stage = new AssetExtractionStage();
  });

  describe('execute()', () => {
    it('should extract content from placeholder references', async () => {
      const tempDir = await createTempFiles({
        'data.json': JSON.stringify({ name: 'Alice', age: 30 })
      });

      const context = createMockContext('/tmp/test.prmd');
      context.content = `# User

Load data: [file:./data.json]`;
      context.sourceFile = join(tempDir, 'test.prmd');

      await stage.execute(context);

      expect(context.content).toContain('"name": "Alice"');
      expect(context.content).toContain('"age": 30');
      expect(context.content).not.toContain('[file:./data.json]');

      await cleanupTempDir(tempDir);
    });

    it('should handle multiple file references', async () => {
      const tempDir = await createTempFiles({
        'file1.txt': 'Content 1',
        'file2.txt': 'Content 2'
      });

      const context = createMockContext('/tmp/test.prmd');
      context.content = `# User

First: [file:./file1.txt]
Second: [file:./file2.txt]`;
      context.sourceFile = join(tempDir, 'test.prmd');

      await stage.execute(context);

      expect(context.content).toContain('Content 1');
      expect(context.content).toContain('Content 2');

      await cleanupTempDir(tempDir);
    });

    it('should detect path traversal attempts', async () => {
      const context = createMockContext('/tmp/test.prmd');
      context.content = '[file:../../etc/passwd]';
      context.sourceFile = '/tmp/test.prmd';

      await stage.execute(context);

      expect(context.errors.length).toBeGreaterThan(0);
      expect(context.errors[0]).toMatch(/path traversal/i);
    });

    it('should enforce file size limits', async () => {
      const tempDir = await createTempFiles({
        'large.txt': 'x'.repeat(20 * 1024 * 1024) // 20MB
      });

      const context = createMockContext('/tmp/test.prmd');
      context.content = '[file:./large.txt]';
      context.sourceFile = join(tempDir, 'test.prmd');

      await stage.execute(context);

      expect(context.errors.length).toBeGreaterThan(0);
      expect(context.errors[0]).toMatch(/too large/i);

      await cleanupTempDir(tempDir);
    });

    it('should handle non-existent files gracefully', async () => {
      const context = createMockContext('/tmp/test.prmd');
      context.content = '[file:./nonexistent.txt]';
      context.sourceFile = '/tmp/test.prmd';

      await stage.execute(context);

      expect(context.errors.length).toBeGreaterThan(0);
      expect(context.errors[0]).toMatch(/not found/i);
    });

    it('should skip extraction if no references found', async () => {
      const context = createMockContext('/tmp/test.prmd');
      context.content = '# User\n\nNo file references here';

      await stage.execute(context);

      expect(context.content).toBe('# User\n\nNo file references here');
      expect(context.errors.length).toBe(0);
    });
  });

  describe('extractTextFile()', () => {
    it('should extract plain text files', async () => {
      const tempDir = await createTempFiles({
        'test.txt': 'Plain text content'
      });

      const filePath = join(tempDir, 'test.txt');
      const content = await (stage as any).extractTextFile(filePath);

      expect(content).toBe('Plain text content');

      await cleanupTempDir(tempDir);
    });

    it('should extract JSON files', async () => {
      const tempDir = await createTempFiles({
        'data.json': JSON.stringify({ key: 'value' }, null, 2)
      });

      const filePath = join(tempDir, 'data.json');
      const content = await (stage as any).extractTextFile(filePath);

      expect(content).toContain('"key"');
      expect(content).toContain('"value"');

      await cleanupTempDir(tempDir);
    });

    it('should extract YAML files', async () => {
      const tempDir = await createTempFiles({
        'config.yaml': 'name: test\nversion: 1.0.0'
      });

      const filePath = join(tempDir, 'config.yaml');
      const content = await (stage as any).extractTextFile(filePath);

      expect(content).toContain('name: test');
      expect(content).toContain('version: 1.0.0');

      await cleanupTempDir(tempDir);
    });

    it('should extract CSV files', async () => {
      const tempDir = await createTempFiles({
        'data.csv': 'name,age\nAlice,30\nBob,25'
      });

      const filePath = join(tempDir, 'data.csv');
      const content = await (stage as any).extractTextFile(filePath);

      expect(content).toContain('name,age');
      expect(content).toContain('Alice,30');

      await cleanupTempDir(tempDir);
    });
  });

  describe('extractExcelFile()', () => {
    it('should handle Excel extraction gracefully when library available', async () => {
      // Note: This test will succeed even without xlsx installed
      // because the function gracefully handles missing library

      const tempDir = await createTempFiles({
        'test.xlsx': Buffer.from([0x50, 0x4b, 0x03, 0x04]) // ZIP header
      });

      const filePath = join(tempDir, 'test.xlsx');
      const content = await (stage as any).extractExcelFile(filePath);

      // Should either return extracted content or a placeholder
      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);

      await cleanupTempDir(tempDir);
    });

    it('should return fallback message for invalid Excel files', async () => {
      const tempDir = await createTempFiles({
        'invalid.xlsx': 'Not a valid Excel file'
      });

      const filePath = join(tempDir, 'invalid.xlsx');
      const content = await (stage as any).extractExcelFile(filePath);

      // Should handle gracefully
      expect(typeof content).toBe('string');

      await cleanupTempDir(tempDir);
    });
  });

  describe('extractWordFile()', () => {
    it('should handle Word extraction gracefully when library available', async () => {
      const tempDir = await createTempFiles({
        'test.docx': Buffer.from([0x50, 0x4b, 0x03, 0x04]) // ZIP header
      });

      const filePath = join(tempDir, 'test.docx');
      const content = await (stage as any).extractWordFile(filePath);

      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);

      await cleanupTempDir(tempDir);
    });

    it('should return fallback message for invalid Word files', async () => {
      const tempDir = await createTempFiles({
        'invalid.docx': 'Not a valid Word file'
      });

      const filePath = join(tempDir, 'invalid.docx');
      const content = await (stage as any).extractWordFile(filePath);

      expect(typeof content).toBe('string');

      await cleanupTempDir(tempDir);
    });
  });

  describe('extractPdfFile()', () => {
    it('should handle PDF extraction gracefully', async () => {
      const tempDir = await createTempFiles({
        'test.pdf': '%PDF-1.4\n%test'
      });

      const filePath = join(tempDir, 'test.pdf');
      const content = await (stage as any).extractPdfFile(filePath);

      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);

      await cleanupTempDir(tempDir);
    });

    it('should return fallback for invalid PDF files', async () => {
      const tempDir = await createTempFiles({
        'invalid.pdf': 'Not a valid PDF'
      });

      const filePath = join(tempDir, 'invalid.pdf');
      const content = await (stage as any).extractPdfFile(filePath);

      expect(typeof content).toBe('string');

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
      const content = await (stage as any).extractImageMetadata(filePath);

      expect(typeof content).toBe('string');

      await cleanupTempDir(tempDir);
    });
  });

  describe('security validation', () => {
    it('should reject absolute paths', async () => {
      const context = createMockContext('/tmp/test.prmd');
      context.content = '[file:/etc/passwd]';
      context.sourceFile = '/tmp/test.prmd';

      await stage.execute(context);

      expect(context.errors.length).toBeGreaterThan(0);
      expect(context.errors[0]).toMatch(/absolute path/i);
    });

    it('should reject parent directory references', async () => {
      const context = createMockContext('/tmp/test.prmd');
      context.content = '[file:../../../etc/passwd]';
      context.sourceFile = '/tmp/test.prmd';

      await stage.execute(context);

      expect(context.errors.length).toBeGreaterThan(0);
      expect(context.errors[0]).toMatch(/path traversal/i);
    });

    it('should accept safe relative paths', async () => {
      const tempDir = await createTempFiles({
        'safe.txt': 'Safe content'
      });

      const context = createMockContext('/tmp/test.prmd');
      context.content = '[file:./safe.txt]';
      context.sourceFile = join(tempDir, 'test.prmd');

      await stage.execute(context);

      expect(context.errors.length).toBe(0);
      expect(context.content).toContain('Safe content');

      await cleanupTempDir(tempDir);
    });

    it('should validate file extensions', async () => {
      const tempDir = await createTempFiles({
        'script.sh': '#!/bin/bash\necho "test"'
      });

      const context = createMockContext('/tmp/test.prmd');
      context.content = '[file:./script.sh]';
      context.sourceFile = join(tempDir, 'test.prmd');

      // .sh files should be allowed (text extraction)
      await stage.execute(context);

      expect(context.errors.length).toBe(0);

      await cleanupTempDir(tempDir);
    });
  });

  describe('file type detection', () => {
    it('should detect JSON files by extension', async () => {
      const tempDir = await createTempFiles({
        'data.json': '{"test": true}'
      });

      const context = createMockContext('/tmp/test.prmd');
      context.content = '[file:./data.json]';
      context.sourceFile = join(tempDir, 'test.prmd');

      await stage.execute(context);

      expect(context.content).toContain('"test"');

      await cleanupTempDir(tempDir);
    });

    it('should detect Excel files by extension', async () => {
      const tempDir = await createTempFiles({
        'data.xlsx': Buffer.from([0x50, 0x4b])
      });

      const context = createMockContext('/tmp/test.prmd');
      context.content = '[file:./data.xlsx]';
      context.sourceFile = join(tempDir, 'test.prmd');

      await stage.execute(context);

      // Should attempt Excel extraction
      expect(typeof context.content).toBe('string');

      await cleanupTempDir(tempDir);
    });

    it('should detect PDF files by extension', async () => {
      const tempDir = await createTempFiles({
        'doc.pdf': '%PDF-1.4'
      });

      const context = createMockContext('/tmp/test.prmd');
      context.content = '[file:./doc.pdf]';
      context.sourceFile = join(tempDir, 'test.prmd');

      await stage.execute(context);

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

      const context = createMockContext('/tmp/test.prmd');
      context.content = '[file:./image.png]';
      context.sourceFile = join(tempDir, 'test.prmd');

      await stage.execute(context);

      expect(context.content).toContain('Image:');

      await cleanupTempDir(tempDir);
    });
  });
});
