/**
 * Tests for Lexical Analysis Stage
 */

import { LexicalAnalysisStage } from '../../../src/lib/compiler/stages/lexical';
import { createMockContext } from '../test-helpers';
import { SIMPLE_PRMD } from '../fixtures/test-files';

describe('LexicalAnalysisStage', () => {
  let stage: LexicalAnalysisStage;

  beforeEach(() => {
    stage = new LexicalAnalysisStage();
  });

  describe('process()', () => {
    it('should parse valid .prmd file and populate context', async () => {
      const context = createMockContext('test.prmd', {
        fileContent: SIMPLE_PRMD
      });

      await stage.process(context);

      expect(context.metadata).toBeDefined();
      expect(context.metadata?.id).toBe('simple-test');
      expect(context.metadata?.name).toBe('Simple Test');
      expect(context.metadata?.version).toBe('1.0.0');
      expect(context.metadata?.parameters).toHaveLength(2);
      expect(context.content).toContain('Hello, {{name}}!');
      expect(context.diagnostics).toHaveLength(0);
    });

    it('should extract parameters correctly', async () => {
      const context = createMockContext('test.prmd', {
        fileContent: SIMPLE_PRMD
      });

      await stage.process(context);

      const params = context.metadata?.parameters || [];
      expect(params[0].name).toBe('name');
      expect(params[0].type).toBe('string');
      expect(params[0].required).toBe(true);
      expect(params[0].default).toBe('World');

      expect(params[1].name).toBe('age');
      expect(params[1].type).toBe('number');
      expect(params[1].default).toBe(25);
    });

    it('should extract content sections', async () => {
      const context = createMockContext('test.prmd', {
        fileContent: SIMPLE_PRMD
      });

      await stage.process(context);

      expect(context.content).toContain('# System');
      expect(context.content).toContain('# User');
      expect(context.content).toContain('helpful assistant');
    });

    it('should handle parsing errors gracefully', async () => {
      const invalidContent = 'not valid yaml\n---\n# Content';
      const context = createMockContext('invalid.prmd', {
        fileContent: invalidContent
      });

      await stage.process(context);

      expect(context.diagnostics.length).toBeGreaterThan(0);
      expect(context.diagnostics[0].message).toContain('Lexical analysis failed');
    });

    it('should handle missing file', async () => {
      const context = createMockContext('nonexistent.prmd');

      await stage.process(context);

      expect(context.diagnostics.length).toBeGreaterThan(0);
      expect(context.diagnostics[0].message).toContain('not found');
    });

    it('should validate required frontmatter', async () => {
      const noFrontmatter = `# Just content without frontmatter`;
      const context = createMockContext('no-frontmatter.prmd', {
        fileContent: noFrontmatter
      });

      await stage.process(context);

      expect(context.diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe('getName()', () => {
    it('should return correct stage name', () => {
      expect(stage.getName()).toBe('Lexical Analysis');
    });
  });

  describe('verbose mode', () => {
    it('should log details in verbose mode', async () => {
      const context = createMockContext('test.prmd', {
        fileContent: SIMPLE_PRMD,
        verbose: true
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await stage.process(context);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
