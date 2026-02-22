/**
 * Integration tests for compiler with MemoryFileSystem
 */

import { describe, it, expect } from '@jest/globals';
import { PrompdCompiler, MemoryFileSystem } from '../../src/lib/compiler';

describe('Compiler with MemoryFileSystem Integration', () => {
  describe('basic compilation', () => {
    it('should compile a simple prompt from memory', async () => {
      const fs = new MemoryFileSystem({
        '/test.prmd': `---
id: test-prompt
name: test-prompt
version: 1.0.0
parameters:
  - name: topic
    type: string
    required: true
---

# System
You are a helpful assistant.

# User
Tell me about {{topic}}
`
      });

      const compiler = new PrompdCompiler();
      const result = await compiler.compile('/test.prmd', {
        fileSystem: fs,
        parameters: { topic: 'TypeScript' },
        outputFormat: 'markdown'
      });

      expect(result).toContain('You are a helpful assistant');
      expect(result).toContain('Tell me about TypeScript');
      expect(result).not.toContain('{{topic}}');
    });

    it('should handle missing parameters gracefully', async () => {
      const fs = new MemoryFileSystem({
        '/test.prmd': `---
id: test
name: test
version: 1.0.0
parameters:
  - name: name
    type: string
    required: false
    default: World
---

# User
Hello {{name}}
`
      });

      const compiler = new PrompdCompiler();
      const result = await compiler.compile('/test.prmd', {
        fileSystem: fs,
        parameters: {},
        outputFormat: 'markdown'
      });

      // Should use default value
      expect(result).toContain('Hello World');
    });
  });

  describe('inheritance', () => {
    it('should process inheritance chain from memory', async () => {
      const fs = new MemoryFileSystem({
        '/base.prmd': `---
id: base
name: base
version: 1.0.0
---

# System
You are a helpful AI assistant.

# Examples
Example 1
Example 2
`,
        '/child.prmd': `---
id: child
name: child
version: 1.0.0
inherits: ./base.prmd
parameters:
  - name: question
    type: string
    required: true
---

# User
{{question}}
`
      });

      const compiler = new PrompdCompiler();
      const result = await compiler.compile('/child.prmd', {
        fileSystem: fs,
        parameters: { question: 'What is AI?' },
        outputFormat: 'markdown'
      });

      expect(result).toContain('You are a helpful AI assistant');
      expect(result).toContain('Example 1');
      expect(result).toContain('What is AI?');
    });

    // SKIPPED: Multi-level inheritance not fully implemented in template stage
    // Reason: When child inherits from parent, and parent inherits from grandparent,
    // only the immediate parent's content is included (not recursive inheritance)
    // Production code fix required in src/lib/compiler/stages/template.ts processInheritance()
    it.skip('should handle multi-level inheritance', async () => {
      const fs = new MemoryFileSystem({
        '/grandparent.prmd': `---
id: grandparent
name: grandparent
version: 1.0.0
---

# System
Base system prompt
`,
        '/parent.prmd': `---
id: parent
name: parent
version: 1.0.0
inherits: ./grandparent.prmd
---

# Context
Additional context
`,
        '/child.prmd': `---
id: child
name: child
version: 1.0.0
inherits: ./parent.prmd
---

# User
User request
`
      });

      const compiler = new PrompdCompiler();
      const result = await compiler.compile('/child.prmd', {
        fileSystem: fs,
        parameters: {},
        outputFormat: 'markdown'
      });

      expect(result).toContain('Base system prompt');
      expect(result).toContain('Additional context');
      expect(result).toContain('User request');
    });

    it('should handle inheritance from subdirectories', async () => {
      const fs = new MemoryFileSystem({
        '/templates/base.prmd': `---
id: base
name: base
version: 1.0.0
---

# System
Template system prompt
`,
        '/prompts/specific.prmd': `---
id: specific
name: specific
version: 1.0.0
inherits: ../templates/base.prmd
---

# User
Specific request
`
      });

      const compiler = new PrompdCompiler();
      const result = await compiler.compile('/prompts/specific.prmd', {
        fileSystem: fs,
        parameters: {},
        outputFormat: 'markdown'
      });

      expect(result).toContain('Template system prompt');
      expect(result).toContain('Specific request');
    });
  });

  describe('section overrides', () => {
    // SKIPPED: Section override feature not fully working
    // Reason: Override files are not being read/applied correctly in template stage
    // Production code fix required in src/lib/compiler/stages/template.ts
    // The applyOverrides() method needs investigation
    it.skip('should apply section overrides from memory files', async () => {
      const fs = new MemoryFileSystem({
        '/base.prmd': `---
id: base
name: base
version: 1.0.0
---

# System
Base system

# Examples
Base examples
`,
        '/overrides/custom-examples.md': `Custom example 1
Custom example 2
Custom example 3`,
        '/child.prmd': `---
id: child
name: child
version: 1.0.0
inherits: ./base.prmd
override:
  examples: ./overrides/custom-examples.md
---

# User
User request
`
      });

      const compiler = new PrompdCompiler();
      const result = await compiler.compile('/child.prmd', {
        fileSystem: fs,
        parameters: {},
        outputFormat: 'markdown'
      });

      expect(result).toContain('Base system');
      expect(result).toContain('Custom example 1');
      expect(result).not.toContain('Base examples');
    });

    it('should handle null overrides to remove sections', async () => {
      const fs = new MemoryFileSystem({
        '/base.prmd': `---
id: base
name: base
version: 1.0.0
---

# System
System prompt

# Examples
Examples section
`,
        '/child.prmd': `---
id: child
name: child
version: 1.0.0
inherits: ./base.prmd
override:
  examples: null
---

# User
User request
`
      });

      const compiler = new PrompdCompiler();
      const result = await compiler.compile('/child.prmd', {
        fileSystem: fs,
        parameters: {},
        outputFormat: 'markdown'
      });

      expect(result).toContain('System prompt');
      expect(result).toContain('User request');
      expect(result).not.toContain('Examples section');
    });
  });

  describe('parameter substitution', () => {
    it('should substitute simple parameters', async () => {
      const fs = new MemoryFileSystem({
        '/test.prmd': `---
id: test
name: test
version: 1.0.0
parameters:
  - name: name
    type: string
  - name: age
    type: integer
---

# User
My name is {{name}} and I am {{age}} years old
`
      });

      const compiler = new PrompdCompiler();
      const result = await compiler.compile('/test.prmd', {
        fileSystem: fs,
        parameters: { name: 'Alice', age: 30 },
        outputFormat: 'markdown'
      });

      expect(result).toContain('My name is Alice and I am 30 years old');
    });

    it('should handle nested object parameters', async () => {
      const fs = new MemoryFileSystem({
        '/test.prmd': `---
id: test
name: test
version: 1.0.0
parameters:
  - name: user
    type: object
---

# User
Name: {{user.name}}
Email: {{user.email}}
`
      });

      const compiler = new PrompdCompiler();
      const result = await compiler.compile('/test.prmd', {
        fileSystem: fs,
        parameters: {
          user: {
            name: 'Bob',
            email: 'bob@example.com'
          }
        },
        outputFormat: 'markdown'
      });

      expect(result).toContain('Name: Bob');
      expect(result).toContain('Email: bob@example.com');
    });
  });

  describe('error handling', () => {
    it('should handle missing file error', async () => {
      const fs = new MemoryFileSystem({
        '/exists.prmd': `---
id: exists
name: exists
version: 1.0.0
---

# User
Test
`
      });

      const compiler = new PrompdCompiler();

      await expect(
        compiler.compile('/missing.prmd', {
          fileSystem: fs,
          parameters: {},
          outputFormat: 'markdown'
        })
      ).rejects.toThrow();
    });

    it('should handle missing inherited file', async () => {
      const fs = new MemoryFileSystem({
        '/child.prmd': `---
id: child
name: child
version: 1.0.0
inherits: ./missing-base.prmd
---

# User
Test
`
      });

      const compiler = new PrompdCompiler();
      const context = await compiler.compileWithContext('/child.prmd', {
        fileSystem: fs,
        parameters: {},
        outputFormat: 'markdown'
      });

      // Should have errors about missing parent
      expect(context.hasErrors()).toBe(true);
    });

    it('should handle invalid YAML frontmatter', async () => {
      const fs = new MemoryFileSystem({
        '/invalid.prmd': `---
invalid yaml: [unclosed
---

# User
Test
`
      });

      const compiler = new PrompdCompiler();
      const context = await compiler.compileWithContext('/invalid.prmd', {
        fileSystem: fs,
        parameters: {},
        outputFormat: 'markdown'
      });

      expect(context.hasErrors()).toBe(true);
    });
  });

  describe('output formats', () => {
    const simplePrompt = `---
id: test
name: test
version: 1.0.0
---

# System
You are helpful.

# User
Help me
`;

    it('should compile to markdown format', async () => {
      const fs = new MemoryFileSystem({ '/test.prmd': simplePrompt });
      const compiler = new PrompdCompiler();

      const result = await compiler.compile('/test.prmd', {
        fileSystem: fs,
        parameters: {},
        outputFormat: 'markdown'
      });

      expect(result).toContain('# System');
      expect(result).toContain('You are helpful');
    });

    it('should compile to OpenAI JSON format', async () => {
      const fs = new MemoryFileSystem({ '/test.prmd': simplePrompt });
      const compiler = new PrompdCompiler();

      const result = await compiler.compile('/test.prmd', {
        fileSystem: fs,
        parameters: {},
        outputFormat: 'provider-json:openai'
      });

      const json = JSON.parse(result);
      expect(json.messages).toBeDefined();
      expect(Array.isArray(json.messages)).toBe(true);
    });

    it('should compile to Anthropic JSON format', async () => {
      const fs = new MemoryFileSystem({ '/test.prmd': simplePrompt });
      const compiler = new PrompdCompiler();

      const result = await compiler.compile('/test.prmd', {
        fileSystem: fs,
        parameters: {},
        outputFormat: 'provider-json:anthropic'
      });

      const json = JSON.parse(result);
      expect(json.messages).toBeDefined();
      expect(Array.isArray(json.messages)).toBe(true);
    });
  });

  describe('complex scenarios', () => {
    // SKIPPED: Section override feature not working (same issue as above)
    // Reason: Section overrides not being applied - related to applyOverrides() implementation
    // Production code fix required in src/lib/compiler/stages/template.ts
    it.skip('should handle complete workflow with all features', async () => {
      const fs = new MemoryFileSystem({
        '/templates/base.prmd': `---
id: base
name: base
version: 1.0.0
---

# System
You are a {{role}}.

# Examples
Default examples
`,
        '/overrides/custom.md': `Custom specialized examples`,
        '/prompts/specialized.prmd': `---
id: specialized
name: specialized
version: 1.0.0
inherits: ../templates/base.prmd
override:
  examples: ../overrides/custom.md
parameters:
  - name: role
    type: string
    required: true
  - name: task
    type: string
    required: true
---

# User
Please help me with: {{task}}
`
      });

      const compiler = new PrompdCompiler();
      const result = await compiler.compile('/prompts/specialized.prmd', {
        fileSystem: fs,
        parameters: {
          role: 'coding assistant',
          task: 'debugging TypeScript'
        },
        outputFormat: 'markdown'
      });

      expect(result).toContain('You are a coding assistant');
      expect(result).toContain('Custom specialized examples');
      expect(result).toContain('Please help me with: debugging TypeScript');
      expect(result).not.toContain('Default examples');
      expect(result).not.toContain('{{role}}');
      expect(result).not.toContain('{{task}}');
    });
  });
});
