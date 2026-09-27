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

## Workflow expressions

`.pdflow` node fields written as `{{ expr }}` are parsed and evaluated as a
small, safe subset of JavaScript — never executed as code (no `new Function`,
`eval`, or `vm`). Scope lookups read own data properties only, never getters
or inherited members.

Allowed: literals (strings, numbers, booleans, `null`/`undefined`, array/
object literals with identifier or string keys), identifiers resolved from
scope, member access (`a.b`, `a[expr]`, `a?.b`, `a?.[expr]`), unary `!`/`-`/`+`,
the arithmetic/comparison/logical operators, `?:`, parentheses, and calls to a
fixed method list — strings: `includes` `startsWith` `endsWith` `toLowerCase`
`toUpperCase` `trim` `indexOf` `slice`; arrays: `includes` `indexOf` `join`
`slice` — always invoked from `String.prototype`/`Array.prototype` directly,
never looked up on the receiver.

Rejected as an `ExpressionError`: any other call, `new`, tagged templates,
assignment (`=` and compound), `++`/`--`, `delete`, `typeof`, `void`, `in`,
`instanceof`, bitwise operators, the comma operator, function/arrow
expressions, template literals, regex literals, spread, and access to
`__proto__`/`constructor`/`prototype` by any path. An expression longer than
`MAX_EXPRESSION_LENGTH` (2,000) characters, or nested deeper than
`MAX_EXPRESSION_DEPTH` (64) levels, is rejected. Globals (`window`, `fetch`,
`process`, `require`, …) are simply not in scope: they read as `undefined`.

```ts
import { evaluateExpression } from '@prompd/core';

evaluateExpression('{{ user.name }}', { user: { name: 'Ada' } }); // 'Ada'
```

- `evaluateExpression(expr, scope, options?)` — parses and evaluates one
  `{{ … }}` expression against `scope`; throws `ExpressionError` on anything
  disallowed, invalid, or over a limit.
- `validateExpression(expr)` — parses without a scope, for validating
  expression syntax while editing (e.g. canvas validation) without needing
  runtime data.
- `describeExpressionFailure(kind, label, err)` — formats a caught
  `ExpressionError` (or any error) into the message a workflow node fails
  with, naming the node kind/label and the rejected construct.
- `isExpressionError(e)` — type guard for `ExpressionError`, safe against a
  thrown look-alike or a `Proxy`.
- `ExpressionError` — thrown by `evaluateExpression`/`validateExpression`;
  carries `message`, `construct` (what was rejected), and `position`.

**`parseJsonStrings` option:** `evaluateExpression(expr, scope, {
parseJsonStrings: true })` additionally lets a NAMED member access (never
`.length`, never a canonical numeric index — those always read the string
itself) navigate INTO a string by parsing it as JSON first, after stripping
one optional ` ``` `/` ```json ` fence (typical of an LLM's JSON reply).
Invalid JSON, an empty string, or a string longer than `MAX_JSON_NAV_LENGTH`
(1,000,000 characters) reads as `undefined`, exactly like a missing property,
never throws. Off by default.

**Limits:** `MAX_EXPRESSION_LENGTH` (2,000), `MAX_EXPRESSION_DEPTH` (64),
`MAX_ARRAY_SCAN` (1,000,000 — the longest array an allowed array method will
scan; a longer array is an evaluation error rather than a silent hang), and
`MAX_JSON_NAV_LENGTH` (1,000,000, `parseJsonStrings` only) are all exported so
a host can reference or test against the same values.

**Coercion is primitive-only.** Every operator that would otherwise coerce a
value (arithmetic, comparison, template-like concatenation) refuses any
object, array, or function outright rather than calling its `toString`/
`valueOf`: `[1] + [2]` is an evaluation error, not `'12'`. `==`/`!=` against an
object or array compare identity (same reference), never structural
equality.

**Hosts must pass plain data.** The evaluator only ever reads own data
properties of plain objects/arrays. The one residual: a `Proxy` placed
anywhere in scope may still have its `getPrototypeOf` and
`getOwnPropertyDescriptor` traps invoked (to classify it and to read one own
property), so a Proxy is trusted to report its own shape honestly — it is not
sandboxed against a trap that lies.

## What's exported

- **Parser:** `PrompdParser`
- **Compiler:** `compile`, `PrompdCompiler`, `CompilerPipeline`, the stages, and the
  formatters (`MarkdownFormatter`, `OpenAIFormatter`, `AnthropicFormatter`)
- **File system / packages:** `IFileSystem`, `MemoryFileSystem`, `HybridFileSystem`,
  `IPackageResolver`
- **Workflows:** `parseWorkflow`, `getExecutionOrder`, `validateWorkflow`,
  `createWorkflowNode`, plus the `WorkflowFile` / node-data types
- **Workflow expressions:** `evaluateExpression`, `validateExpression`,
  `describeExpressionFailure`, `isExpressionError`, `ExpressionError`,
  `MAX_EXPRESSION_LENGTH`, `MAX_EXPRESSION_DEPTH`, `MAX_ARRAY_SCAN`,
  `MAX_JSON_NAV_LENGTH`
- **Types & errors:** `PrompdMetadata`, `PrompdParameter`, `CompilationOptions`,
  `CompilationError`, `ValidationError`, …

See the bundled `dist/index.d.ts` for the full surface.

## License

[MIT](./LICENSE) © 2024–2026 Prompd LLC. (The Prompd registry and hosted services
are separately licensed.)
