import { PrompdParser } from '../src/lib/parser';
import * as fs from 'fs-extra';
import * as path from 'path';

describe('PrompdParser', () => {
  let parser: PrompdParser;
  
  beforeEach(() => {
    parser = new PrompdParser();
  });

  describe('parseContent', () => {
    it('should parse valid prompd content', () => {
      const content = `---
name: test-prompt
description: A test prompt
version: 1.0.0
parameters:
  - name: topic
    type: string
    required: true
    description: The topic to discuss
---

# Test Prompt

Please discuss {topic} in detail.`;

      const result = parser.parseContent(content);
      
      expect(result.metadata.name).toBe('test-prompt');
      expect(result.metadata.description).toBe('A test prompt');
      expect(result.metadata.version).toBe('1.0.0');
      expect(result.metadata.parameters).toHaveLength(1);
      expect(result.metadata.parameters![0].name).toBe('topic');
      expect(result.content).toContain('Please discuss {topic} in detail.');
    });

    it('should throw error for content without frontmatter', () => {
      const content = 'This is just plain content without frontmatter';
      
      expect(() => parser.parseContent(content)).toThrow('File must start with YAML frontmatter');
    });

    it('should throw error for invalid frontmatter format', () => {
      const content = '---\nname: test\n---invalid';
      
      expect(() => parser.parseContent(content)).toThrow('Invalid frontmatter format');
    });

    it('should throw error for invalid YAML', () => {
      const content = `---
name: test
invalid: yaml: content: [
---

Content here`;
      
      expect(() => parser.parseContent(content)).toThrow('Failed to parse YAML frontmatter');
    });
  });

  describe('validateFile', () => {
    it('should validate file with no issues', async () => {
      const content = `---
name: valid-prompt
description: A valid prompt
version: 1.0.0
parameters:
  - name: input
    type: string
    required: true
---

Process this input: {input}`;

      jest.spyOn(parser, 'parseFile').mockResolvedValue(parser.parseContent(content));
      
      const issues = await parser.validateFile('test.prompd');
      expect(issues).toHaveLength(0);
    });

    it('should detect missing required name field', async () => {
      const content = `---
description: Missing name field
parameters:
  - name: input
    type: string
---

Content with {input}`;

      jest.spyOn(parser, 'parseFile').mockResolvedValue(parser.parseContent(content));
      
      const issues = await parser.validateFile('test.prompd');
      expect(issues).toHaveLength(1);
      expect(issues[0].level).toBe('error');
      expect(issues[0].message).toBe('name field is required');
    });

    it('should detect invalid semantic version', async () => {
      const content = `---
name: test-prompt
version: invalid-version
---

Content`;

      jest.spyOn(parser, 'parseFile').mockResolvedValue(parser.parseContent(content));
      
      const issues = await parser.validateFile('test.prompd');
      expect(issues).toHaveLength(1);
      expect(issues[0].level).toBe('error');
      expect(issues[0].message).toBe('invalid semantic version: invalid-version');
    });

    it('should detect undefined variable references', async () => {
      const content = `---
name: test-prompt
parameters:
  - name: input
    type: string
---

Content with {input} and {undefined_var}`;

      jest.spyOn(parser, 'parseFile').mockResolvedValue(parser.parseContent(content));
      
      const issues = await parser.validateFile('test.prompd');
      expect(issues).toHaveLength(1);
      expect(issues[0].level).toBe('error');
      expect(issues[0].message).toBe('undefined variable referenced: undefined_var');
    });

    it('should validate parameter types', async () => {
      const content = `---
name: test-prompt
parameters:
  - name: param1
    type: invalid-type
  - name: param2
    type: string
---

Content with {param1} and {param2}`;

      jest.spyOn(parser, 'parseFile').mockResolvedValue(parser.parseContent(content));
      
      const issues = await parser.validateFile('test.prompd');
      expect(issues).toHaveLength(1);
      expect(issues[0].level).toBe('error');
      expect(issues[0].message).toBe('invalid parameter type: invalid-type. Must be one of: string, number, boolean, array, object');
    });

    it('should handle backward compatibility with variables field', async () => {
      const content = `---
name: test-prompt
variables:
  - name: old_var
    type: string
---

Content with {old_var}`;

      jest.spyOn(parser, 'parseFile').mockResolvedValue(parser.parseContent(content));
      
      const issues = await parser.validateFile('test.prompd');
      expect(issues).toHaveLength(0);
    });
  });
});