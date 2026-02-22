# Server-Side Compilation with In-Memory File System

This document demonstrates how to use the npm compiler with an in-memory file system for server-side compilation without writing files to disk.

## Overview

The compiler now supports a file system abstraction layer that allows you to:
- Compile prompts without touching the file system
- Pass file contents as a dictionary/map
- Handle inheritance chains entirely in memory
- Use the compiler in serverless/cloud environments

## Basic Usage

```typescript
import { PrompdCompiler, MemoryFileSystem } from 'prompd';

// Create in-memory file system with your files
const fileSystem = new MemoryFileSystem({
  '/main.prmd': `---
id: main-prompt
name: main-prompt
version: 1.0.0
inherits: /base.prmd
parameters:
  - name: topic
    type: string
    required: true
---

# User
Write about {topic}
`,

  '/base.prmd': `---
id: base-prompt
name: base-prompt
version: 1.0.0
---

# System
You are a helpful AI assistant.
`
});

// Create compiler with custom file system
const compiler = new PrompdCompiler();

// Compile using the in-memory file system
const result = await compiler.compile('/main.prmd', {
  fileSystem,
  parameters: { topic: 'JavaScript' },
  outputFormat: 'markdown'
});

console.log(result);
```

## Advanced Example with Inheritance Chain

```typescript
import { PrompdCompiler, MemoryFileSystem } from 'prompd';

// Define your file hierarchy
const files = {
  '/prompts/base.prmd': `---
id: base
name: base
version: 1.0.0
---

# System
You are a helpful assistant.

# Examples
Example 1
Example 2
`,

  '/prompts/specialized.prmd': `---
id: specialized
name: specialized
version: 1.0.0
inherits: /prompts/base.prmd
override:
  examples: /overrides/custom-examples.md
---

# User
{question}
`,

  '/overrides/custom-examples.md': `Example A
Example B
Example C`
};

// Create file system
const fs = new MemoryFileSystem(files);

// Compile
const compiler = new PrompdCompiler();
const result = await compiler.compile('/prompts/specialized.prmd', {
  fileSystem: fs,
  parameters: { question: 'What is TypeScript?' }
});

console.log(result);
```

## Express/Fastify Server Integration

```typescript
import express from 'express';
import { PrompdCompiler, MemoryFileSystem } from 'prompd';

const app = express();
app.use(express.json());

app.post('/compile', async (req, res) => {
  try {
    const { files, mainFile, parameters, outputFormat } = req.body;

    // Create in-memory file system from request payload
    const fileSystem = new MemoryFileSystem(files);

    // Compile
    const compiler = new PrompdCompiler();
    const result = await compiler.compile(mainFile, {
      fileSystem,
      parameters: parameters || {},
      outputFormat: outputFormat || 'markdown'
    });

    res.json({
      success: true,
      result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(3000, () => {
  console.log('Compiler server running on port 3000');
});
```

## Request/Response Example

### Request
```http
POST /compile HTTP/1.1
Content-Type: application/json

{
  "files": {
    "/main.prmd": "---\nid: test\nname: test\nversion: 1.0.0\n---\n\n# User\nHello {name}",
    "/base.prmd": "---\nid: base\nname: base\nversion: 1.0.0\n---\n\n# System\nYou are helpful."
  },
  "mainFile": "/main.prmd",
  "parameters": {
    "name": "World"
  },
  "outputFormat": "markdown"
}
```

### Response
```json
{
  "success": true,
  "result": "# System\nYou are helpful.\n\n# User\nHello World"
}
```

## API Reference

### MemoryFileSystem

Constructor that accepts a map of file paths to content:

```typescript
const fs = new MemoryFileSystem({
  '/path/to/file1.prmd': 'content1',
  '/path/to/file2.md': 'content2'
});
```

Methods:
- `addFile(path: string, content: string)` - Add a single file
- `addFiles(files: Record<string, string>)` - Add multiple files
- All standard IFileSystem methods (exists, readFile, isDirectory, etc.)

### CompilationOptions

Extended to include `fileSystem`:

```typescript
interface CompilationOptions {
  outputFormat?: string;           // 'markdown' | 'provider-json:openai' | etc.
  parameters?: Record<string, any>; // Parameter substitution values
  outputFile?: string;              // Optional file output path (still uses Node fs)
  verbose?: boolean;                // Enable verbose logging
  fileSystem?: IFileSystem;         // Custom file system implementation
}
```

## Path Handling

The MemoryFileSystem normalizes paths:
- Converts backslashes to forward slashes
- Removes leading `./`
- Treats paths as Unix-style (forward slashes)

Example:
```typescript
const fs = new MemoryFileSystem();
fs.addFile('./prompts/main.prmd', 'content');

// All of these will work:
fs.readFile('prompts/main.prmd');
fs.readFile('./prompts/main.prmd');
fs.readFile('/prompts/main.prmd');
```

## Security Considerations

When using MemoryFileSystem:
- No file system security checks are performed (no file size limits, no path traversal checks)
- You are responsible for validating file contents before adding them
- Recommended: Add your own validation layer before passing files to the compiler

Example with validation:

```typescript
function validateFiles(files: Record<string, string>): void {
  const maxFileSize = 1024 * 1024; // 1MB
  const maxTotalSize = 10 * 1024 * 1024; // 10MB

  let totalSize = 0;

  for (const [path, content] of Object.entries(files)) {
    // Check file size
    if (content.length > maxFileSize) {
      throw new Error(`File too large: ${path}`);
    }

    totalSize += content.length;

    // Check path for directory traversal
    if (path.includes('..')) {
      throw new Error(`Invalid path: ${path}`);
    }
  }

  // Check total size
  if (totalSize > maxTotalSize) {
    throw new Error('Total files size exceeds limit');
  }
}

// Use in your endpoint
app.post('/compile', async (req, res) => {
  const { files, mainFile, parameters } = req.body;

  validateFiles(files);

  const fileSystem = new MemoryFileSystem(files);
  const compiler = new PrompdCompiler();

  const result = await compiler.compile(mainFile, {
    fileSystem,
    parameters
  });

  res.json({ result });
});
```

## Testing

Example test using the in-memory file system:

```typescript
import { describe, it, expect } from '@jest/globals';
import { PrompdCompiler, MemoryFileSystem } from 'prompd';

describe('Compiler with MemoryFileSystem', () => {
  it('should compile with inheritance', async () => {
    const fs = new MemoryFileSystem({
      '/base.prmd': `---
id: base
name: base
version: 1.0.0
---

# System
Base system prompt`,

      '/child.prmd': `---
id: child
name: child
version: 1.0.0
inherits: /base.prmd
---

# User
{question}`
    });

    const compiler = new PrompdCompiler();
    const result = await compiler.compile('/child.prmd', {
      fileSystem: fs,
      parameters: { question: 'What is AI?' }
    });

    expect(result).toContain('Base system prompt');
    expect(result).toContain('What is AI?');
  });
});
```

## Performance Notes

- MemoryFileSystem is synchronous - no async overhead
- No disk I/O means faster compilation
- Ideal for serverless functions and API endpoints
- Memory usage scales with the number and size of files

## Limitations

- No support for package references (@namespace/package) with MemoryFileSystem
- Directory listing is emulated (less efficient than real fs)
- No automatic file watching or caching
