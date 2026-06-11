# @prompd/core

Environment-agnostic core for [Prompd](https://prompd.app) — the `.prmd` parser,
the compilation pipeline (Nunjucks templating + output formatters), the `.pdflow`
workflow parser, and an injectable file-system / package-resolver.

It has **no Node-only imports**, so the same code runs in Node, the browser, and the
backend. Anything platform-specific (disk access, the registry client) is injected
through the `IFileSystem` / `IPackageResolver` interfaces.

> Status: **beta** (`0.5.x-beta`). The API may still shift before `1.0`.

## Install

```bash
npm install @prompd/core
# or: pnpm add @prompd/core
```

Dual-published as ESM and CommonJS, with TypeScript types.

## Quick start

A `.prmd` file is YAML frontmatter + a Jinja2/Nunjucks body with typed parameters:

```ts
import { compile } from '@prompd/core';

const source = `---
id: greeting
name: Greeting
version: 1.0.0
parameters:
  - name: who
    type: string
    default: World
---
Hello {{ who }}!`;

// compile(source, outputFormat?, parameters?, options?) => Promise<string>
await compile(source);                          // -> "Hello World!"  (markdown, default)
await compile(source, 'markdown', { who: 'Prompd' });   // -> "Hello Prompd!"
await compile(source, 'openai',   { who: 'Prompd' });   // -> OpenAI chat JSON
await compile(source, 'anthropic',{ who: 'Prompd' });   // -> Anthropic messages JSON
```

Output formats: `markdown` (default), `openai`, `anthropic`.

## Inheritance, includes & packages

`inherits:` and `{% include %}` resolve against other files through an injected
`IFileSystem`. In the browser, supply a `MemoryFileSystem`; on the server, supply
your own disk-backed implementation. A package resolver is injected the same way
(omit it where packages aren't available, e.g. the browser).

```ts
import { compile, MemoryFileSystem } from '@prompd/core';

const fs = new MemoryFileSystem({
  'base.prmd': `---
id: base
name: Base
version: 1.0.0
---
{% block body %}{% endblock %}`,
  'child.prmd': `---
id: child
name: Child
version: 1.0.0
inherits: base.prmd
---
{% block body %}Hi {{ who }}{% endblock %}`,
});

const child = await fs.read('child.prmd');
const out = await compile(child, 'markdown', { who: 'there' }, { fileSystem: fs });
```

## Parameters

Declared in frontmatter and validated/coerced at compile time. Types: `string`,
`number`, `integer`, `float`, `boolean`, `array`, `object`, `json`, `file`,
`base64`, and `date` / `datetime`.

`date` / `datetime` defaults (and provided values) may be **relative expressions**
resolved at compile time, so each run uses the current date:

```yaml
parameters:
  - name: start
    type: date
    default: "now-7d"     # also: now, today, now+1w, now-3m, now-1y, now-2h, now-30min
  - name: when
    type: datetime
    default: "now"        # -> "YYYY-MM-DDTHH:mm:ss"
```

ISO / date-parseable literals (`"2026-01-15"`) pass through unchanged.

## Workflows (`.pdflow`)

```ts
import { parseWorkflow, getExecutionOrder, validateWorkflow } from '@prompd/core';

const { file, errors, warnings } = parseWorkflow(jsonText);
const order = getExecutionOrder(file);   // topological node order
const result = validateWorkflow(file);
```

## What's exported

- **Parser:** `PrompdParser`
- **Compiler:** `compile`, `PrompdCompiler`, `CompilerPipeline`, the stages, and the
  formatters (`MarkdownFormatter`, `OpenAIFormatter`, `AnthropicFormatter`)
- **File system / packages:** `IFileSystem`, `MemoryFileSystem`, `HybridFileSystem`,
  `IPackageResolver`
- **Workflows:** `parseWorkflow`, `getExecutionOrder`, `validateWorkflow`,
  `createWorkflowNode`, plus the `WorkflowFile` / node-data types
- **Types & errors:** `PrompdMetadata`, `PrompdParameter`, `CompilationOptions`,
  `CompilationError`, `ValidationError`, …

See the bundled `dist/index.d.ts` for the full surface.

## License

[MIT](./LICENSE) © 2024–2026 Prompd LLC. (The Prompd registry and hosted services
are separately licensed.)
