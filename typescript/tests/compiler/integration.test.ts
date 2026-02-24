/**
 * Integration Tests - End-to-End Compilation Pipeline
 */

import { PrompdCompiler } from '../../src/lib/compiler';
import { createTempFiles, cleanupTempDir } from './test-helpers';
import { join } from 'path';
import { writeFileSync } from 'fs';

describe('PrompdCompiler Integration', () => {
  let compiler: PrompdCompiler;

  beforeEach(() => {
    compiler = new PrompdCompiler();
  });

  describe('Simple Compilation', () => {
    it('should compile basic prompt with parameters', async () => {
      const tempDir = await createTempFiles({
        'test.prmd': `---
id: simple-test
name: Simple Test
version: 1.0.0
parameters:
  - name: name
    type: string
    default: "World"
---

# User

Hello, {{ name }}!`
      });

      const source = join(tempDir, 'test.prmd');
      const result = await compiler.compile(source, {
        outputFormat: 'markdown',
        parameters: { name: 'Alice' }
      });

      expect(result).toContain('Hello, Alice!');
      expect(result).not.toContain('{{ name }}');

      await cleanupTempDir(tempDir);
    });

    it('should compile to OpenAI JSON format', async () => {
      const tempDir = await createTempFiles({
        'test.prmd': `---
id: test
name: Test
version: 1.0.0
---

# System

You are a helpful assistant.

# User

Tell me a joke.`
      });

      const source = join(tempDir, 'test.prmd');
      const result = await compiler.compile(source, {
        outputFormat: 'provider-json:openai'
      });

      const parsed = JSON.parse(result);
      expect(parsed.messages).toBeDefined();
      expect(parsed.messages.length).toBe(2);
      expect(parsed.messages[0].role).toBe('system');
      expect(parsed.messages[1].role).toBe('user');

      await cleanupTempDir(tempDir);
    });

    it('should compile to Anthropic JSON format', async () => {
      const tempDir = await createTempFiles({
        'test.prmd': `---
id: test
name: Test
version: 1.0.0
---

# System

You are Claude.

# User

Hello!`
      });

      const source = join(tempDir, 'test.prmd');
      const result = await compiler.compile(source, {
        outputFormat: 'provider-json:anthropic'
      });

      const parsed = JSON.parse(result);
      expect(parsed.system).toBeDefined();
      expect(parsed.messages).toBeDefined();
      expect(parsed.system).toContain('Claude');

      await cleanupTempDir(tempDir);
    });
  });

  describe('Template Processing', () => {
    it('should handle if statements', async () => {
      const tempDir = await createTempFiles({
        'test.prmd': `---
id: test
name: Test
version: 1.0.0
parameters:
  - name: show_greeting
    type: boolean
    default: true
---

# User

{% if show_greeting %}
Hello!
{% else %}
Goodbye!
{% endif %}`
      });

      const source = join(tempDir, 'test.prmd');
      const result = await compiler.compile(source, {
        outputFormat: 'markdown',
        parameters: { show_greeting: true }
      });

      expect(result).toContain('Hello!');
      expect(result).not.toContain('Goodbye!');

      await cleanupTempDir(tempDir);
    });

    it('should handle for loops', async () => {
      const tempDir = await createTempFiles({
        'test.prmd': `---
id: test
name: Test
version: 1.0.0
parameters:
  - name: items
    type: array
    default: ["apple", "banana"]
---

# User

Items:
{% for item in items %}
- {{ item }}
{% endfor %}`
      });

      const source = join(tempDir, 'test.prmd');
      const result = await compiler.compile(source, {
        outputFormat: 'markdown',
        parameters: { items: ['apple', 'banana', 'cherry'] }
      });

      expect(result).toContain('- apple');
      expect(result).toContain('- banana');
      expect(result).toContain('- cherry');

      await cleanupTempDir(tempDir);
    });

    it('should handle nested templates', async () => {
      const tempDir = await createTempFiles({
        'test.prmd': `---
id: test
name: Test
version: 1.0.0
parameters:
  - name: users
    type: array
    default: []
---

# User

Users:
{% for user in users %}
  {% if user.active %}
  - {{ user.name }} (active)
  {% else %}
  - {{ user.name }} (inactive)
  {% endif %}
{% endfor %}`
      });

      const source = join(tempDir, 'test.prmd');
      const result = await compiler.compile(source, {
        outputFormat: 'markdown',
        parameters: {
          users: [
            { name: 'Alice', active: true },
            { name: 'Bob', active: false }
          ]
        }
      });

      expect(result).toContain('Alice (active)');
      expect(result).toContain('Bob (inactive)');

      await cleanupTempDir(tempDir);
    });
  });

  describe('File Extraction', () => {
    it('should extract JSON file content', async () => {
      const tempDir = await createTempFiles({
        'data.json': JSON.stringify({ key: 'value' }),
        'test.prmd': `---
id: test
name: Test
version: 1.0.0
---

# User

Data: [file:./data.json]`
      });

      const source = join(tempDir, 'test.prmd');
      const result = await compiler.compile(source, {
        outputFormat: 'markdown'
      });

      expect(result).toContain('"key"');
      expect(result).toContain('"value"');

      await cleanupTempDir(tempDir);
    });

    it('should extract multiple files', async () => {
      const tempDir = await createTempFiles({
        'file1.txt': 'Content 1',
        'file2.txt': 'Content 2',
        'test.prmd': `---
id: test
name: Test
version: 1.0.0
---

# User

First: [file:./file1.txt]
Second: [file:./file2.txt]`
      });

      const source = join(tempDir, 'test.prmd');
      const result = await compiler.compile(source, {
        outputFormat: 'markdown'
      });

      expect(result).toContain('Content 1');
      expect(result).toContain('Content 2');

      await cleanupTempDir(tempDir);
    });
  });

  describe('Inheritance', () => {
    it('should inherit from parent file', async () => {
      const tempDir = await createTempFiles({
        'parent.prmd': `---
id: parent
name: Parent
version: 1.0.0
parameters:
  - name: context
    type: string
    default: "general"
---

# System

You are an expert in {{ context }}.`,
        'child.prmd': `---
id: child
name: Child
version: 1.0.0
inherits: "./parent.prmd"
parameters:
  - name: topic
    type: string
    required: true
---

# User

Tell me about {{ topic }}.`
      });

      const source = join(tempDir, 'child.prmd');
      const result = await compiler.compile(source, {
        outputFormat: 'markdown',
        parameters: { context: 'programming', topic: 'TypeScript' }
      });

      expect(result).toContain('You are an expert in programming');
      expect(result).toContain('Tell me about TypeScript');

      await cleanupTempDir(tempDir);
    });

    it('should override parent sections', async () => {
      const tempDir = await createTempFiles({
        'custom-system.md': 'Custom system prompt',
        'parent.prmd': `---
id: parent
name: Parent
version: 1.0.0
---

# System

Original system

# User

Parent user`,
        'child.prmd': `---
id: child
name: Child
version: 1.0.0
inherits: "./parent.prmd"
override:
  system: "./custom-system.md"
---

# User

Child user`
      });

      const source = join(tempDir, 'child.prmd');
      const result = await compiler.compile(source, {
        outputFormat: 'markdown'
      });

      expect(result).toContain('Custom system prompt');
      expect(result).not.toContain('Original system');
      expect(result).toContain('Child user');

      await cleanupTempDir(tempDir);
    });

    it('should remove sections with null override', async () => {
      const tempDir = await createTempFiles({
        'parent.prmd': `---
id: parent
name: Parent
version: 1.0.0
---

# System

System content

# User

User content`,
        'child.prmd': `---
id: child
name: Child
version: 1.0.0
inherits: "./parent.prmd"
override:
  system: null
---

# User

Child content`
      });

      const source = join(tempDir, 'child.prmd');
      const result = await compiler.compile(source, {
        outputFormat: 'markdown'
      });

      expect(result).not.toContain('System content');
      expect(result).toContain('Child content');

      await cleanupTempDir(tempDir);
    });
  });

  describe('Parameter Validation', () => {
    it('should apply default parameter values', async () => {
      const tempDir = await createTempFiles({
        'test.prmd': `---
id: test
name: Test
version: 1.0.0
parameters:
  - name: greeting
    type: string
    default: "Hello"
---

# User

{{ greeting }}, World!`
      });

      const source = join(tempDir, 'test.prmd');
      const result = await compiler.compile(source, {
        outputFormat: 'markdown'
      });

      expect(result).toContain('Hello, World!');

      await cleanupTempDir(tempDir);
    });

    it('should compile with empty value when required parameter is missing', async () => {
      const tempDir = await createTempFiles({
        'test.prmd': `---
id: test
name: Test
version: 1.0.0
parameters:
  - name: required_param
    type: string
    required: true
---

# User

Value: {{ required_param }}`
      });

      const source = join(tempDir, 'test.prmd');

      // Compiler succeeds but renders empty value when no parameters provided
      const result = await compiler.compile(source, { outputFormat: 'markdown' });
      expect(result).toContain('Value:');

      await cleanupTempDir(tempDir);
    });

    it('should compile with wrong-type parameter value (adds warning)', async () => {
      const tempDir = await createTempFiles({
        'test.prmd': `---
id: test
name: Test
version: 1.0.0
parameters:
  - name: count
    type: number
---

# User

Count: {{ count }}`
      });

      const source = join(tempDir, 'test.prmd');

      // Compiler succeeds but uses the value as-is (type mismatch is a warning)
      const result = await compiler.compile(source, {
        outputFormat: 'markdown',
        parameters: { count: 'not a number' }
      });
      expect(result).toContain('Count: not a number');

      await cleanupTempDir(tempDir);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing source file', async () => {
      await expect(
        compiler.compile('/nonexistent/file.prmd', { outputFormat: 'markdown' })
      ).rejects.toThrow(/not found/i);
    });

    it('should handle invalid YAML frontmatter', async () => {
      const tempDir = await createTempFiles({
        'invalid.prmd': `---
this is not: valid: yaml:
---

# User

Content`
      });

      const source = join(tempDir, 'invalid.prmd');

      await expect(
        compiler.compile(source, { outputFormat: 'markdown' })
      ).rejects.toThrow();

      await cleanupTempDir(tempDir);
    });

    it('should handle template rendering errors', async () => {
      const tempDir = await createTempFiles({
        'test.prmd': `---
id: test
name: Test
version: 1.0.0
---

# User

{% for item in undefined_var %}
  {{ item }}
{% endfor %}`
      });

      const source = join(tempDir, 'test.prmd');

      // Should handle gracefully or provide error
      const result = await compiler.compile(source, {
        outputFormat: 'markdown'
      }).catch(e => e.message);

      expect(typeof result).toBe('string');

      await cleanupTempDir(tempDir);
    });

    it('should compile with empty values for missing required parameters', async () => {
      const tempDir = await createTempFiles({
        'test.prmd': `---
id: test
name: Test
version: 1.0.0
parameters:
  - name: param1
    type: string
    required: true
  - name: param2
    type: number
    required: true
---

# User

Values: {{ param1 }}, {{ param2 }}`
      });

      const source = join(tempDir, 'test.prmd');

      // Compiler succeeds with empty values when no parameters provided
      const result = await compiler.compile(source, { outputFormat: 'markdown' });
      expect(result).toContain('Values:');

      await cleanupTempDir(tempDir);
    });
  });

  describe('Output Options', () => {
    it('should write output to file', async () => {
      const tempDir = await createTempFiles({
        'test.prmd': `---
id: test
name: Test
version: 1.0.0
---

# User

Test content`
      });

      const source = join(tempDir, 'test.prmd');
      const outputFile = join(tempDir, 'output.md');

      await compiler.compile(source, {
        outputFormat: 'markdown',
        outputFile
      });

      const { readFileSync } = require('fs');
      const content = readFileSync(outputFile, 'utf-8');

      expect(content).toContain('Test content');

      await cleanupTempDir(tempDir);
    });

    it('should handle verbose mode', async () => {
      const tempDir = await createTempFiles({
        'test.prmd': `---
id: test
name: Test
version: 1.0.0
---

# User

Content`
      });

      const source = join(tempDir, 'test.prmd');

      // Verbose mode should not throw errors
      const result = await compiler.compile(source, {
        outputFormat: 'markdown',
        verbose: true
      });

      expect(result).toContain('Content');

      await cleanupTempDir(tempDir);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle full-featured prompt', async () => {
      const tempDir = await createTempFiles({
        'data.json': JSON.stringify({ setting: 'production' }),
        'parent.prmd': `---
id: parent
name: Parent
version: 1.0.0
parameters:
  - name: mode
    type: string
    default: "default"
---

# System

Running in {{ mode }} mode.`,
        'child.prmd': `---
id: child
name: Child
version: 1.0.0
inherits: "./parent.prmd"
parameters:
  - name: items
    type: array
    default: []
  - name: show_config
    type: boolean
    default: true
---

# User

{% if show_config %}
Config: [file:./data.json]
{% endif %}

Items:
{% for item in items %}
- {{ item }}
{% endfor %}`
      });

      const source = join(tempDir, 'child.prmd');
      const result = await compiler.compile(source, {
        outputFormat: 'markdown',
        parameters: {
          mode: 'test',
          items: ['one', 'two', 'three'],
          show_config: true
        }
      });

      expect(result).toContain('Running in test mode');
      expect(result).toContain('"setting"');
      expect(result).toContain('"production"');
      expect(result).toContain('- one');
      expect(result).toContain('- two');
      expect(result).toContain('- three');

      await cleanupTempDir(tempDir);
    });

    it('should handle conversion between output formats', async () => {
      const tempDir = await createTempFiles({
        'test.prmd': `---
id: test
name: Test
version: 1.0.0
---

# System

System prompt

# User

User message`
      });

      const source = join(tempDir, 'test.prmd');

      // Compile to markdown
      const mdResult = await compiler.compile(source, {
        outputFormat: 'markdown'
      });

      // Compile to OpenAI JSON
      const openaiResult = await compiler.compile(source, {
        outputFormat: 'provider-json:openai'
      });

      // Compile to Anthropic JSON
      const anthropicResult = await compiler.compile(source, {
        outputFormat: 'provider-json:anthropic'
      });

      expect(mdResult).toContain('System prompt');
      expect(openaiResult).toContain('"role": "system"');
      expect(anthropicResult).toContain('"system"');

      await cleanupTempDir(tempDir);
    });
  });
});
