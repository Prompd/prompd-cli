/**
 * Tests for Semantic Analysis Stage
 */

import { SemanticAnalysisStage } from '../../../src/lib/compiler/stages/semantic';
import { createMockContext } from '../test-helpers';
import { PrompdMetadata } from '../../../src/types';

describe('SemanticAnalysisStage', () => {
  let stage: SemanticAnalysisStage;

  beforeEach(() => {
    stage = new SemanticAnalysisStage();
  });

  describe('process()', () => {
    it('should apply default parameter values', async () => {
      const context = createMockContext('/test.prmd', {
        parameters: {}
      });

      context.metadata = {
        id: 'test',
        parameters: [
          { name: 'name', type: 'string', default: 'World' },
          { name: 'age', type: 'number', default: 25 }
        ]
      } as PrompdMetadata;

      await stage.process(context);

      expect(context.parameters.name).toBe('World');
      expect(context.parameters.age).toBe(25);
      expect(context.errors).toHaveLength(0);
    });

    it('should not override provided parameters', async () => {
      const context = createMockContext('/test.prmd', {
        parameters: { name: 'Alice' }
      });

      context.metadata = {
        id: 'test',
        parameters: [
          { name: 'name', type: 'string', default: 'World' }
        ]
      } as PrompdMetadata;

      await stage.process(context);

      expect(context.parameters.name).toBe('Alice');
    });

    it('should warn about missing required parameters', async () => {
      const context = createMockContext('/test.prmd', {
        parameters: {}
      });

      context.metadata = {
        id: 'test',
        parameters: [
          { name: 'required_param', type: 'string', required: true }
        ]
      } as PrompdMetadata;

      await stage.process(context);

      expect(context.warnings.length).toBeGreaterThan(0);
      expect(context.warnings[0]).toContain('required_param');
    });

    it('should validate parameter types', async () => {
      const context = createMockContext('/test.prmd', {
        parameters: { age: 'not a number' }
      });

      context.metadata = {
        id: 'test',
        parameters: [
          { name: 'age', type: 'number' }
        ]
      } as PrompdMetadata;

      await stage.process(context);

      expect(context.warnings.length).toBeGreaterThan(0);
      expect(context.warnings[0]).toContain('incorrect type');
    });

    it('should validate string patterns', async () => {
      const context = createMockContext('/test.prmd', {
        parameters: { email: 'invalid-email' }
      });

      context.metadata = {
        id: 'test',
        parameters: [
          {
            name: 'email',
            type: 'string',
            pattern: '^[\\w.-]+@[\\w.-]+\\.\\w+$'
          }
        ]
      } as PrompdMetadata;

      await stage.process(context);

      expect(context.warnings.length).toBeGreaterThan(0);
      expect(context.warnings[0]).toContain('does not match pattern');
    });

    it('should validate number ranges', async () => {
      const context = createMockContext('/test.prmd', {
        parameters: { score: 150 }
      });

      context.metadata = {
        id: 'test',
        parameters: [
          {
            name: 'score',
            type: 'number',
            minimum: 0,
            maximum: 100
          }
        ]
      } as PrompdMetadata;

      await stage.process(context);

      expect(context.warnings.length).toBeGreaterThan(0);
      expect(context.warnings[0]).toContain('exceeds maximum');
    });

    it('should validate array types', async () => {
      const context = createMockContext('/test.prmd', {
        parameters: { items: ['a', 'b', 'c'] }
      });

      context.metadata = {
        id: 'test',
        parameters: [
          { name: 'items', type: 'array' }
        ]
      } as PrompdMetadata;

      await stage.process(context);

      expect(context.warnings).toHaveLength(0);
    });

    it('should validate object types', async () => {
      const context = createMockContext('/test.prmd', {
        parameters: { user: { name: 'Alice', age: 30 } }
      });

      context.metadata = {
        id: 'test',
        parameters: [
          { name: 'user', type: 'object' }
        ]
      } as PrompdMetadata;

      await stage.process(context);

      expect(context.warnings).toHaveLength(0);
    });

    it('should validate boolean types', async () => {
      const context = createMockContext('/test.prmd', {
        parameters: { enabled: true }
      });

      context.metadata = {
        id: 'test',
        parameters: [
          { name: 'enabled', type: 'boolean' }
        ]
      } as PrompdMetadata;

      await stage.process(context);

      expect(context.warnings).toHaveLength(0);
    });

    it('should handle metadata without parameters', async () => {
      const context = createMockContext('/test.prmd');
      context.metadata = { id: 'test' } as PrompdMetadata;

      await stage.process(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should handle context without metadata', async () => {
      const context = createMockContext('/test.prmd');

      await stage.process(context);

      expect(context.errors).toHaveLength(0);
    });
  });

  describe('getName()', () => {
    it('should return correct stage name', () => {
      expect(stage.getName()).toBe('Semantic Analysis');
    });
  });

  describe('verbose mode', () => {
    it('should log parameter defaults in verbose mode', async () => {
      const context = createMockContext('/test.prmd', {
        parameters: {},
        verbose: true
      });

      context.metadata = {
        id: 'test',
        parameters: [
          { name: 'name', type: 'string', default: 'World' }
        ]
      } as PrompdMetadata;

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await stage.process(context);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('edge cases', () => {
    it('should handle null defaults', async () => {
      const context = createMockContext('/test.prmd', {
        parameters: {}
      });

      context.metadata = {
        id: 'test',
        parameters: [
          { name: 'nullable', type: 'string', default: null as any }
        ]
      } as PrompdMetadata;

      await stage.process(context);

      expect(context.parameters.nullable).toBeUndefined();
    });

    it('should handle minimum value validation', async () => {
      const context = createMockContext('/test.prmd', {
        parameters: { score: -10 }
      });

      context.metadata = {
        id: 'test',
        parameters: [
          {
            name: 'score',
            type: 'number',
            minimum: 0
          }
        ]
      } as PrompdMetadata;

      await stage.process(context);

      expect(context.warnings.length).toBeGreaterThan(0);
      expect(context.warnings[0]).toContain('below minimum');
    });
  });
});
