/**
 * Tests for Lexical Analysis Stage
 */

import { LexicalAnalysisStage } from '../../../src/lib/compiler/stages/lexical';
import { createMockContext, createTempFile, cleanupTempDir } from '../test-helpers';
import { SIMPLE_PRMD, INVALID_PRMD } from '../fixtures/test-files';
import * as path from 'path';

describe('LexicalAnalysisStage', () => {
  let stage: LexicalAnalysisStage;

  beforeEach(() => {
    stage = new LexicalAnalysisStage();
  });

  describe('process()', () => {
    it('should parse valid .prmd file and populate context', async () => {
      const filePath = await createTempFile('test.prmd', SIMPLE_PRMD);
      const context = createMockContext(filePath);

      await stage.process(context);

      expect(context.metadata).toBeDefined();
      expect(context.metadata?.id).toBe('simple-test');
      expect(context.metadata?.name).toBe('Simple Test');
      expect(context.metadata?.version).toBe('1.0.0');
      expect(context.metadata?.parameters).toHaveLength(2);
      expect(context.content).toContain('Hello, {name}!');
      expect(context.errors).toHaveLength(0);

      await cleanupTempDir(path.dirname(filePath));
    });

    it('should extract parameters correctly', async () => {
      const filePath = await createTempFile('test.prmd', SIMPLE_PRMD);
      const context = createMockContext(filePath);

      await stage.process(context);

      const params = context.metadata?.parameters || [];
      expect(params[0].name).toBe('name');
      expect(params[0].type).toBe('string');
      expect(params[0].required).toBe(true);
      expect(params[0].default).toBe('World');

      expect(params[1].name).toBe('age');
      expect(params[1].type).toBe('number');
      expect(params[1].default).toBe(25);

      await cleanupTempDir(path.dirname(filePath));
    });

    it('should extract content sections', async () => {
      const filePath = await createTempFile('test.prmd', SIMPLE_PRMD);
      const context = createMockContext(filePath);

      await stage.process(context);

      expect(context.content).toContain('# System');
      expect(context.content).toContain('# User');
      expect(context.content).toContain('helpful assistant');

      await cleanupTempDir(path.dirname(filePath));
    });

    it('should handle parsing errors gracefully', async () => {
      const filePath = await createTempFile('invalid.prmd', 'not valid yaml\n---\n# Content');
      const context = createMockContext(filePath);

      await stage.process(context);

      expect(context.errors.length).toBeGreaterThan(0);
      expect(context.errors[0]).toContain('Lexical analysis failed');

      await cleanupTempDir(path.dirname(filePath));
    });

    it('should handle missing file', async () => {
      const context = createMockContext('/nonexistent/file.prmd');

      await stage.process(context);

      expect(context.errors.length).toBeGreaterThan(0);
      expect(context.errors[0]).toContain('not found');
    });

    it('should validate required frontmatter', async () => {
      const noFrontmatter = `# Just content without frontmatter`;
      const filePath = await createTempFile('no-frontmatter.prmd', noFrontmatter);
      const context = createMockContext(filePath);

      await stage.process(context);

      expect(context.errors.length).toBeGreaterThan(0);

      await cleanupTempDir(path.dirname(filePath));
    });
  });

  describe('getName()', () => {
    it('should return correct stage name', () => {
      expect(stage.getName()).toBe('Lexical Analysis');
    });
  });

  describe('verbose mode', () => {
    it('should log details in verbose mode', async () => {
      const filePath = await createTempFile('test.prmd', SIMPLE_PRMD);
      const context = createMockContext(filePath, { verbose: true });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await stage.process(context);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();

      await cleanupTempDir(path.dirname(filePath));
    });
  });
});
