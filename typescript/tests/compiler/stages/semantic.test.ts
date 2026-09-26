/**
 * Tests for Semantic Analysis Stage
 */

import { SemanticAnalysisStage } from '@prompd/core';
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
        name: 'Test Prompt',
        version: '1.0.0',
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
        name: 'Test Prompt',
        version: '1.0.0',
        parameters: [
          { name: 'name', type: 'string', default: 'World' }
        ]
      } as PrompdMetadata;

      await stage.process(context);

      expect(context.parameters.name).toBe('Alice');
    });

    it('should warn about missing required parameters', async () => {
      const context = createMockContext('/test.prmd', {
        parameters: { someOtherParam: 'value' } // Provide at least one param to trigger execution mode
      });

      context.metadata = {
        id: 'test',
        name: 'Test Prompt',
        version: '1.0.0',
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
        name: 'Test Prompt',
        version: '1.0.0',
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
        name: 'Test Prompt',
        version: '1.0.0',
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
        name: 'Test Prompt',
        version: '1.0.0',
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
        name: 'Test Prompt',
        version: '1.0.0',
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
        name: 'Test Prompt',
        version: '1.0.0',
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
        name: 'Test Prompt',
        version: '1.0.0',
        parameters: [
          { name: 'enabled', type: 'boolean' }
        ]
      } as PrompdMetadata;

      await stage.process(context);

      expect(context.warnings).toHaveLength(0);
    });

    it('should handle metadata without parameters', async () => {
      const context = createMockContext('/test.prmd');
      context.metadata = {
        id: 'test',
        name: 'Test Prompt',
        version: '1.0.0'
      } as PrompdMetadata;

      await stage.process(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should handle context without metadata', async () => {
      const context = createMockContext('/test.prmd');

      await stage.process(context);

      expect(context.errors).toHaveLength(0);
    });
  });

  describe('date / datetime parameters', () => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const runWithParam = async (param: any, provided: Record<string, unknown> = {}) => {
      const context = createMockContext('/test.prmd', { parameters: { ...provided } });
      context.metadata = {
        id: 'test',
        name: 'Test Prompt',
        version: '1.0.0',
        parameters: [param]
      } as PrompdMetadata;
      await stage.process(context);
      return context;
    };

    it('resolves a "now" default to today (YYYY-MM-DD)', async () => {
      const context = await runWithParam({ name: 'start', type: 'date', default: 'now' });
      expect(context.parameters.start).toBe(fmtDate(new Date()));
      expect(context.warnings).toHaveLength(0);
    });

    it('resolves a "today" default to today', async () => {
      const context = await runWithParam({ name: 'start', type: 'date', default: 'today' });
      expect(context.parameters.start).toBe(fmtDate(new Date()));
    });

    it('resolves a "now-7d" relative default to 7 days ago', async () => {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      const context = await runWithParam({ name: 'end', type: 'date', default: 'now-7d' });
      expect(context.parameters.end).toBe(fmtDate(d));
    });

    it('resolves a "now+1w" relative default to one week ahead', async () => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      const context = await runWithParam({ name: 'next', type: 'date', default: 'now+1w' });
      expect(context.parameters.next).toBe(fmtDate(d));
    });

    it('passes through an ISO date literal default unchanged', async () => {
      const context = await runWithParam({ name: 'fixed', type: 'date', default: '2026-01-15' });
      expect(context.parameters.fixed).toBe('2026-01-15');
      expect(context.warnings).toHaveLength(0);
    });

    it('resolves a datetime default to YYYY-MM-DDTHH:mm:ss', async () => {
      const context = await runWithParam({ name: 'ts', type: 'datetime', default: 'now' });
      expect(String(context.parameters.ts)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
      expect(context.warnings).toHaveLength(0);
    });

    it('resolves a relative value provided at execution time', async () => {
      const context = await runWithParam({ name: 'start', type: 'date' }, { start: 'now' });
      expect(context.parameters.start).toBe(fmtDate(new Date()));
    });

    it('warns when a date value cannot be parsed', async () => {
      const context = await runWithParam({ name: 'start', type: 'date' }, { start: 'not-a-date' });
      expect(context.warnings.length).toBeGreaterThan(0);
      expect(context.warnings[0]).toContain('incorrect type');
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
        name: 'Test Prompt',
        version: '1.0.0',
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
        name: 'Test Prompt',
        version: '1.0.0',
        parameters: [
          { name: 'nullable', type: 'string', default: null as any }
        ]
      } as PrompdMetadata;

      await stage.process(context);

      // null is a valid default value and should be applied
      expect(context.parameters.nullable).toBeNull();
    });

    it('should handle minimum value validation', async () => {
      const context = createMockContext('/test.prmd', {
        parameters: { score: -10 }
      });

      context.metadata = {
        id: 'test',
        name: 'Test Prompt',
        version: '1.0.0',
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
