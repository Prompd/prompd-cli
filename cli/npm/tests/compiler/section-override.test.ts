/**
 * Tests for Section Override Processor
 */

import { SectionOverrideProcessor } from '../../src/lib/compiler/section-override';
import { createTempFiles, cleanupTempDir } from './test-helpers';
import * as path from 'path';

describe('SectionOverrideProcessor', () => {
  let processor: SectionOverrideProcessor;

  beforeEach(() => {
    processor = new SectionOverrideProcessor();
  });

  describe('extractSections()', () => {
    it('should extract sections from markdown', () => {
      const content = `# System

System content here

## Context

Context content

# User

User content`;

      const sections = processor.extractSections(content);

      expect(sections.size).toBe(3);
      expect(sections.has('system')).toBe(true);
      expect(sections.has('context')).toBe(true);
      expect(sections.has('user')).toBe(true);
    });

    it('should generate kebab-case IDs', () => {
      const content = `# System Prompt

Content

## User Input Section

More content`;

      const sections = processor.extractSections(content);

      expect(sections.has('system-prompt')).toBe(true);
      expect(sections.has('user-input-section')).toBe(true);
    });

    it('should handle explicit section IDs', () => {
      const content = `<!-- section-id: custom-system -->
# System

Content`;

      const sections = processor.extractSections(content);

      expect(sections.has('custom-system')).toBe(true);
    });

    it('should detect duplicate section IDs', () => {
      const content = `# System

First

# System

Second`;

      expect(() => processor.extractSections(content)).toThrow(/duplicate/i);
    });

    it('should handle empty content', () => {
      const sections = processor.extractSections('');

      expect(sections.size).toBe(0);
    });

    it('should preserve section content', () => {
      const content = `# System

Line 1
Line 2
Line 3`;

      const sections = processor.extractSections(content);
      const systemSection = sections.get('system');

      expect(systemSection?.content).toContain('Line 1');
      expect(systemSection?.content).toContain('Line 2');
      expect(systemSection?.content).toContain('Line 3');
    });

    it('should handle different heading levels', () => {
      const content = `# Level 1

Content 1

## Level 2

Content 2

### Level 3

Content 3`;

      const sections = processor.extractSections(content);

      expect(sections.get('level-1')?.headingLevel).toBe(1);
      expect(sections.get('level-2')?.headingLevel).toBe(2);
      expect(sections.get('level-3')?.headingLevel).toBe(3);
    });
  });

  describe('applyOverrides()', () => {
    it('should replace section with file content', async () => {
      const tempDir = await createTempFiles({
        'custom.md': 'Custom system content'
      });

      const parentSections = processor.extractSections(`# System

Original system

# User

User content`);

      const childSections = new Map();
      const overrides = {
        system: './custom.md'
      };

      const result = await processor.applyOverrides(
        parentSections,
        childSections,
        overrides,
        tempDir,
        false
      );

      expect(result).toContain('Custom system content');
      expect(result).not.toContain('Original system');

      await cleanupTempDir(tempDir);
    });

    it('should remove section with null override', async () => {
      const parentSections = processor.extractSections(`# System

System content

# User

User content`);

      const childSections = new Map();
      const overrides = {
        system: null
      };

      const result = await processor.applyOverrides(
        parentSections,
        childSections,
        overrides,
        '/tmp',
        false
      );

      expect(result).not.toContain('System content');
      expect(result).toContain('User content');
    });

    it('should merge parent and child sections', async () => {
      const parentSections = processor.extractSections(`# System

Parent system

# Context

Parent context`);

      const childSections = processor.extractSections(`# User

Child user`);

      const result = await processor.applyOverrides(
        parentSections,
        childSections,
        {},
        '/tmp',
        false
      );

      expect(result).toContain('Parent system');
      expect(result).toContain('Parent context');
      expect(result).toContain('Child user');
    });

    it('should prioritize child sections over parent', async () => {
      const parentSections = processor.extractSections(`# System

Parent system`);

      const childSections = processor.extractSections(`# System

Child system`);

      const result = await processor.applyOverrides(
        parentSections,
        childSections,
        {},
        '/tmp',
        false
      );

      expect(result).toContain('Child system');
      expect(result).not.toContain('Parent system');
    });

    it('should handle non-existent override section', async () => {
      const parentSections = processor.extractSections(`# System

System content`);

      const childSections = new Map();
      const overrides = {
        'non-existent': './file.md'
      };

      // Should not throw, just skip the override
      const result = await processor.applyOverrides(
        parentSections,
        childSections,
        overrides,
        '/tmp',
        false
      );

      expect(result).toContain('System content');
    });
  });

  describe('loadOverrideContent()', () => {
    it('should load content from file', async () => {
      const tempDir = await createTempFiles({
        'override.md': 'Override content here'
      });

      const content = await processor.loadOverrideContent('./override.md', tempDir);

      expect(content).toBe('Override content here');

      await cleanupTempDir(tempDir);
    });

    it('should throw error for non-existent file', async () => {
      await expect(
        processor.loadOverrideContent('./nonexistent.md', '/tmp')
      ).rejects.toThrow(/not found/i);
    });

    it('should detect path traversal attempts', async () => {
      await expect(
        processor.loadOverrideContent('../../../etc/passwd', '/tmp')
      ).rejects.toThrow(/traversal/i);
    });

    it('should reject files that are too large', async () => {
      const tempDir = await createTempFiles({
        'large.md': 'x'.repeat(20 * 1024 * 1024) // 20MB
      });

      await expect(
        processor.loadOverrideContent('./large.md', tempDir)
      ).rejects.toThrow(/too large/i);

      await cleanupTempDir(tempDir);
    });
  });

  describe('security validation', () => {
    it('should validate section ID format', () => {
      const invalidContent = `<!-- section-id: Invalid ID! -->
# Section

Content`;

      expect(() => processor.extractSections(invalidContent)).toThrow(/invalid section id/i);
    });

    it('should reject section IDs with dangerous patterns', () => {
      const dangerousContent = `<!-- section-id: __proto__ -->
# Section

Content`;

      expect(() => processor.extractSections(dangerousContent)).toThrow(/forbidden pattern/i);
    });

    it('should reject excessively long section IDs', () => {
      const longId = 'a'.repeat(150);
      const content = `<!-- section-id: ${longId} -->
# Section

Content`;

      expect(() => processor.extractSections(content)).toThrow(/too long/i);
    });
  });
});
