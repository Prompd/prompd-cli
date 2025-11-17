/**
 * Tests for Output Formatters (Markdown, OpenAI, Anthropic)
 */

import { MarkdownFormatter } from '../../../src/lib/compiler/formatters/markdown';
import { OpenAIFormatter } from '../../../src/lib/compiler/formatters/openai';
import { AnthropicFormatter } from '../../../src/lib/compiler/formatters/anthropic';
import { CompilationContext } from '../../../src/lib/compiler/types';
import { createMockContext } from '../test-helpers';

describe('MarkdownFormatter', () => {
  let formatter: MarkdownFormatter;

  beforeEach(() => {
    formatter = new MarkdownFormatter();
  });

  it('should format basic markdown content', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# System

You are a helpful assistant.

# User

Hello, world!`;

    const result = await formatter.format(context);

    expect(result).toContain('# System');
    expect(result).toContain('You are a helpful assistant');
    expect(result).toContain('# User');
    expect(result).toContain('Hello, world!');
  });

  it('should include YAML frontmatter in verbose mode', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = '# User\n\nTest content';
    context.metadata = {
      id: 'test-prompt',
      name: 'Test Prompt',
      version: '1.0.0',
      description: 'A test prompt',
      parameters: []
    };
    context.verbose = true;

    const result = await formatter.format(context);

    expect(result).toContain('---');
    expect(result).toContain('id: test-prompt');
    expect(result).toContain('name: Test Prompt');
    expect(result).toContain('version: 1.0.0');
  });

  it('should not include frontmatter in non-verbose mode', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = '# User\n\nTest content';
    context.metadata = {
      id: 'test-prompt',
      name: 'Test Prompt',
      version: '1.0.0',
      parameters: []
    };
    context.verbose = false;

    const result = await formatter.format(context);

    expect(result).not.toContain('---');
    expect(result).not.toContain('id: test-prompt');
    expect(result).toContain('# User');
    expect(result).toContain('Test content');
  });

  it('should handle content with multiple sections', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# System

System prompt

## Context

Context information

# User

User request

## Examples

Example data`;

    const result = await formatter.format(context);

    expect(result).toContain('# System');
    expect(result).toContain('## Context');
    expect(result).toContain('# User');
    expect(result).toContain('## Examples');
  });
});

describe('OpenAIFormatter', () => {
  let formatter: OpenAIFormatter;

  beforeEach(() => {
    formatter = new OpenAIFormatter();
  });

  it('should format content as OpenAI messages array', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# System

You are a helpful assistant.

# User

Hello, world!`;

    const result = await formatter.format(context);
    const parsed = JSON.parse(result);

    expect(parsed.messages).toBeDefined();
    expect(Array.isArray(parsed.messages)).toBe(true);
    expect(parsed.messages.length).toBe(2);
  });

  it('should extract system message correctly', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# System

You are a helpful assistant.

# User

User content`;

    const result = await formatter.format(context);
    const parsed = JSON.parse(result);

    const systemMsg = parsed.messages.find((m: any) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content).toContain('You are a helpful assistant');
  });

  it('should extract user message correctly', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# System

System content

# User

User request here`;

    const result = await formatter.format(context);
    const parsed = JSON.parse(result);

    const userMsg = parsed.messages.find((m: any) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg.content).toContain('User request here');
  });

  it('should handle content without system section', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# User

Just a user message`;

    const result = await formatter.format(context);
    const parsed = JSON.parse(result);

    expect(parsed.messages.length).toBe(1);
    expect(parsed.messages[0].role).toBe('user');
  });

  it('should merge context section into system', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# System

You are a helpful assistant.

# Context

Additional context information.

# User

User request`;

    const result = await formatter.format(context);
    const parsed = JSON.parse(result);

    const systemMsg = parsed.messages.find((m: any) => m.role === 'system');
    expect(systemMsg.content).toContain('You are a helpful assistant');
    expect(systemMsg.content).toContain('Additional context information');
  });

  it('should include examples section in user message', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# System

System prompt

# User

User request

# Examples

Example 1: Test
Example 2: Demo`;

    const result = await formatter.format(context);
    const parsed = JSON.parse(result);

    const userMsg = parsed.messages.find((m: any) => m.role === 'user');
    expect(userMsg.content).toContain('User request');
    expect(userMsg.content).toContain('Example 1: Test');
    expect(userMsg.content).toContain('Example 2: Demo');
  });

  it('should handle assistant message role', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# System

System content

# Assistant

Assistant response

# User

Follow-up`;

    const result = await formatter.format(context);
    const parsed = JSON.parse(result);

    const assistantMsg = parsed.messages.find((m: any) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.content).toContain('Assistant response');
  });
});

describe('AnthropicFormatter', () => {
  let formatter: AnthropicFormatter;

  beforeEach(() => {
    formatter = new AnthropicFormatter();
  });

  it('should format content as Anthropic system + messages', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# System

You are a helpful assistant.

# User

Hello, world!`;

    const result = await formatter.format(context);
    const parsed = JSON.parse(result);

    expect(parsed.system).toBeDefined();
    expect(parsed.messages).toBeDefined();
    expect(Array.isArray(parsed.messages)).toBe(true);
  });

  it('should extract system field correctly', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# System

You are Claude, a helpful AI assistant.

# User

User request`;

    const result = await formatter.format(context);
    const parsed = JSON.parse(result);

    expect(parsed.system).toContain('You are Claude');
    expect(parsed.system).toContain('helpful AI assistant');
  });

  it('should create messages array without system role', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# System

System content

# User

User message`;

    const result = await formatter.format(context);
    const parsed = JSON.parse(result);

    expect(parsed.messages.length).toBe(1);
    expect(parsed.messages[0].role).toBe('user');

    // System should not be in messages array
    const systemMsg = parsed.messages.find((m: any) => m.role === 'system');
    expect(systemMsg).toBeUndefined();
  });

  it('should merge context into system field', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# System

Base system prompt.

# Context

Additional context data.

# User

User request`;

    const result = await formatter.format(context);
    const parsed = JSON.parse(result);

    expect(parsed.system).toContain('Base system prompt');
    expect(parsed.system).toContain('Additional context data');
  });

  it('should handle content without system section', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# User

Just a user message`;

    const result = await formatter.format(context);
    const parsed = JSON.parse(result);

    expect(parsed.system).toBe('');
    expect(parsed.messages.length).toBe(1);
    expect(parsed.messages[0].role).toBe('user');
  });

  it('should include examples in user message', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# System

System prompt

# User

User request

# Examples

Example 1
Example 2`;

    const result = await formatter.format(context);
    const parsed = JSON.parse(result);

    const userMsg = parsed.messages.find((m: any) => m.role === 'user');
    expect(userMsg.content).toContain('User request');
    expect(userMsg.content).toContain('Example 1');
    expect(userMsg.content).toContain('Example 2');
  });

  it('should handle assistant role correctly', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# System

System content

# User

First message

# Assistant

Response

# User

Follow-up`;

    const result = await formatter.format(context);
    const parsed = JSON.parse(result);

    expect(parsed.messages.length).toBe(3);
    expect(parsed.messages[0].role).toBe('user');
    expect(parsed.messages[1].role).toBe('assistant');
    expect(parsed.messages[2].role).toBe('user');
  });

  it('should alternate user/assistant messages correctly', async () => {
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# System

System

# User

Message 1

# Assistant

Response 1

# User

Message 2`;

    const result = await formatter.format(context);
    const parsed = JSON.parse(result);

    expect(parsed.messages[0].role).toBe('user');
    expect(parsed.messages[0].content).toContain('Message 1');
    expect(parsed.messages[1].role).toBe('assistant');
    expect(parsed.messages[1].content).toContain('Response 1');
    expect(parsed.messages[2].role).toBe('user');
    expect(parsed.messages[2].content).toContain('Message 2');
  });
});

describe('Formatter Integration', () => {
  it('should produce valid JSON for OpenAI format', async () => {
    const formatter = new OpenAIFormatter();
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# System\n\nTest system\n\n# User\n\nTest user`;

    const result = await formatter.format(context);

    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('should produce valid JSON for Anthropic format', async () => {
    const formatter = new AnthropicFormatter();
    const context = createMockContext('/tmp/test.prmd');
    context.content = `# System\n\nTest system\n\n# User\n\nTest user`;

    const result = await formatter.format(context);

    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('should produce consistent output format', async () => {
    const mdFormatter = new MarkdownFormatter();
    const openaiFormatter = new OpenAIFormatter();
    const anthropicFormatter = new AnthropicFormatter();

    const context = createMockContext('/tmp/test.prmd');
    context.content = `# System\n\nTest\n\n# User\n\nRequest`;

    const mdResult = await mdFormatter.format(context);
    const openaiResult = await openaiFormatter.format(context);
    const anthropicResult = await anthropicFormatter.format(context);

    expect(typeof mdResult).toBe('string');
    expect(typeof openaiResult).toBe('string');
    expect(typeof anthropicResult).toBe('string');

    // All should contain the core content
    expect(mdResult).toContain('Test');
    expect(openaiResult).toContain('Test');
    expect(anthropicResult).toContain('Test');
  });
});
