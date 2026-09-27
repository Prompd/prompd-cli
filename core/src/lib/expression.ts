/* Safe workflow expressions: a small JavaScript subset, parsed and evaluated
 * without ever executing the text as code. Shared by every workflow engine.
 * Spec: prompd-web/docs/superpowers/specs/2026-09-26-safe-workflow-expressions-design.md */

// Marks instances this module itself constructed. Checked with WeakSet#has,
// which invokes no trap (unlike `instanceof`, whose `getPrototypeOf` step on
// a Proxy can run host code and even throw), so the catch boundary in
// evaluateExpression can tell a genuine ExpressionError from a look-alike
// (or a thrown Proxy) without itself being made to throw or lie.
const BRANDED = new WeakSet<object>();

export class ExpressionError extends Error {
  readonly construct: string;
  readonly position: number;
  constructor(message: string, construct: string, position: number) {
    super(message);
    this.name = 'ExpressionError';
    this.construct = construct;
    this.position = position;
    BRANDED.add(this);
  }
}

/** True only for an ExpressionError this module constructed itself. Used at
 * the evaluateExpression catch boundary in place of `instanceof`, which
 * would run a thrown Proxy's `getPrototypeOf` trap. */
function isOwnExpressionError(e: unknown): e is ExpressionError {
  return typeof e === 'object' && e !== null && BRANDED.has(e);
}

export function isExpressionError(e: unknown): e is ExpressionError {
  return e instanceof ExpressionError || (e instanceof Error && e.name === 'ExpressionError');
}

export const MAX_EXPRESSION_LENGTH = 2000;
export const MAX_EXPRESSION_DEPTH = 64;

export const BLOCKED_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
export const STRING_METHODS: ReadonlySet<string> = new Set([
  'includes', 'startsWith', 'endsWith', 'toLowerCase', 'toUpperCase', 'trim', 'indexOf', 'slice',
]);
export const ARRAY_METHODS: ReadonlySet<string> = new Set(['includes', 'indexOf', 'join', 'slice']);

/* Maps, not object literals: a lookup like KEYWORDS['constructor'] on a plain
 * object would return Object.prototype.constructor. */
const KEYWORD_CONSTRUCTS: ReadonlyMap<string, string> = new Map([
  ['new', "'new'"], ['typeof', "'typeof'"], ['void', "'void'"], ['delete', "'delete'"],
  ['in', "the 'in' operator"], ['instanceof', "'instanceof'"], ['function', 'a function expression'],
  ['class', 'a class expression'], ['this', "'this'"], ['await', "'await'"], ['yield', "'yield'"],
  ['import', "'import'"], ['super', "'super'"], ['let', 'a declaration'], ['var', 'a declaration'],
  ['const', 'a declaration'], ['return', 'a statement'],
]);
const ASSIGNMENT_OPS = ['=', '+=', '-=', '*=', '/=', '%=', '**=', '&=', '|=', '^=', '<<=', '>>=', '>>>=', '&&=', '||=', '??='];
const OP_CONSTRUCTS: ReadonlyMap<string, string> = new Map([
  ...ASSIGNMENT_OPS.map((o): [string, string] => [o, 'assignment']),
  ['=>', 'an arrow function'], ['++', 'increment/decrement'], ['--', 'increment/decrement'],
  ['&', 'a bitwise operator'], ['|', 'a bitwise operator'], ['^', 'a bitwise operator'], ['~', 'a bitwise operator'],
  ['<<', 'a bitwise operator'], ['>>', 'a bitwise operator'], ['>>>', 'a bitwise operator'],
  ['**', 'the exponent operator'], [',', 'the comma operator'], [';', 'a statement separator'], ['...', 'spread'],
]);
const OPS = [
  ...ASSIGNMENT_OPS, '...', '===', '!==', '>>>', '=>', '**', '?.', '??', '==', '!=', '<=', '>=', '&&', '||', '++', '--',
  '<<', '>>', '(', ')', '[', ']', '{', '}', ',', ':', '.', '?', '!', '+', '-', '*', '/', '%', '<', '>', '&', '|', '^', '~', ';',
].sort((a, b) => b.length - a.length);

export function disallowed(construct: string, position: number): ExpressionError {
  return new ExpressionError(`${construct} is not allowed in a workflow expression`, construct, position);
}
export function syntax(message: string, position: number): ExpressionError {
  return new ExpressionError(message, 'syntax error', position);
}

export function describeExpressionFailure(kind: string, label: string, e: ExpressionError): string {
  return e.construct === 'syntax error' || e.construct === 'evaluation error'
    ? `${kind} on "${label}" has an invalid expression: ${e.message} (position ${e.position}).`
    : `${kind} on "${label}" can't run: ${e.construct}, which workflow expressions can't do (position ${e.position}).`;
}

type Tok =
  | { t: 'num'; v: number; p: number }
  | { t: 'str'; v: string; p: number }
  | { t: 'id'; v: string; p: number }
  | { t: 'op'; v: string; p: number }
  | { t: 'eof'; p: number };

const SIMPLE_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['n', '\n'], ['t', '\t'], ['r', '\r'], ['b', '\b'], ['f', '\f'], ['v', '\v'], ['0', '\0'],
]);

function readString(src: string, start: number): [string, number] {
  const q = src[start];
  let out = '';
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === q) return [out, i + 1];
    if (c === '\n') break;
    if (c === '\\') {
      const n = src[i + 1];
      if (n === undefined) break;
      const simple = SIMPLE_ESCAPES.get(n);
      if (simple !== undefined) { out += simple; i += 2; continue; }
      if (n === 'x' || n === 'u') {
        const len = n === 'x' ? 2 : 4;
        const hex = src.slice(i + 2, i + 2 + len);
        if (!new RegExp(`^[0-9a-fA-F]{${len}}$`).test(hex)) throw syntax('invalid escape sequence', i);
        out += String.fromCharCode(parseInt(hex, 16));
        i += 2 + len;
        continue;
      }
      out += n;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  throw syntax('unterminated string', start);
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '`') throw disallowed('a template literal', i);
    if (c === '"' || c === "'") {
      const [s, next] = readString(src, i);
      toks.push({ t: 'str', v: s, p: i });
      i = next;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw syntax('invalid number', i);
      toks.push({ t: 'num', v: Number(m[0]), p: i });
      i += m[0].length;
      if (/[A-Za-z_$0-9]/.test(src[i] ?? '')) throw syntax('invalid number', i);
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
      const name = m ? m[0] : c;
      toks.push({ t: 'id', v: name, p: i });
      i += name.length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i) && !(o === '?.' && /[0-9]/.test(src[i + 2] ?? '')));
    if (!op) throw syntax(`unexpected character '${c}'`, i);
    toks.push({ t: 'op', v: op, p: i });
    i += op.length;
  }
  toks.push({ t: 'eof', p: src.length });
  return toks;
}

export type ExprNode =
  | { k: 'lit'; v: unknown }
  | { k: 'id'; name: string; p: number }
  | { k: 'arr'; items: ExprNode[] }
  | { k: 'obj'; props: Array<{ key: string; value: ExprNode }> }
  | { k: 'member'; obj: ExprNode; prop: string | ExprNode; optional: boolean; p: number; paren?: boolean }
  | { k: 'call'; recv: ExprNode; name: string; args: ExprNode[]; optional: boolean; p: number; paren?: boolean }
  | { k: 'unary'; op: '!' | '-' | '+'; arg: ExprNode; p: number }
  | { k: 'bin'; op: string; l: ExprNode; r: ExprNode; p: number }
  | { k: 'cond'; test: ExprNode; yes: ExprNode; no: ExprNode };

class Parser {
  private i = 0;
  private depth = 0;
  constructor(private readonly toks: Tok[]) {}

  parseAll(): ExprNode {
    const n = this.expr();
    const t = this.peek();
    if (t.t !== 'eof') throw this.unexpected(t);
    return n;
  }

  private peek(): Tok { return this.toks[this.i]; }
  private next(): Tok { return this.toks[this.i++]; }
  private isOp(v: string): boolean { const t = this.peek(); return t.t === 'op' && t.v === v; }
  private eatOp(v: string): boolean { if (this.isOp(v)) { this.i++; return true; } return false; }
  private expectOp(v: string): void { if (!this.eatOp(v)) throw this.unexpected(this.peek()); }

  private enter(p: number): void {
    if (++this.depth > MAX_EXPRESSION_DEPTH) throw disallowed(`nesting deeper than ${MAX_EXPRESSION_DEPTH} levels`, p);
  }
  private leave(): void { this.depth--; }

  private unexpected(t: Tok): ExpressionError {
    if (t.t === 'eof') return syntax('unexpected end of expression', t.p);
    if (t.t === 'id') {
      const kw = KEYWORD_CONSTRUCTS.get(t.v);
      return kw ? disallowed(kw, t.p) : syntax(`unexpected '${t.v}'`, t.p);
    }
    if (t.t !== 'op') return syntax('unexpected value', t.p);
    const c = OP_CONSTRUCTS.get(t.v);
    return c ? disallowed(c, t.p) : syntax(`unexpected '${t.v}'`, t.p);
  }

  private expr(): ExprNode {
    this.enter(this.peek().p);
    try { return this.conditional(); } finally { this.leave(); }
  }

  private conditional(): ExprNode {
    const test = this.nullish();
    if (!this.eatOp('?')) return test;
    const yes = this.expr();
    this.expectOp(':');
    const no = this.expr();
    return { k: 'cond', test, yes, no };
  }

  private binaryLevel(ops: readonly string[], nextLevel: () => ExprNode): ExprNode {
    let l = nextLevel();
    for (;;) {
      const t = this.peek();
      if (t.t !== 'op' || !ops.includes(t.v)) return l;
      this.i++;
      l = { k: 'bin', op: t.v, l, r: nextLevel(), p: t.p };
    }
  }
  private nullish(): ExprNode { return this.binaryLevel(['??'], () => this.or()); }
  private or(): ExprNode { return this.binaryLevel(['||'], () => this.and()); }
  private and(): ExprNode { return this.binaryLevel(['&&'], () => this.equality()); }
  private equality(): ExprNode { return this.binaryLevel(['==', '!=', '===', '!=='], () => this.relational()); }
  private relational(): ExprNode { return this.binaryLevel(['<', '<=', '>', '>='], () => this.additive()); }
  private additive(): ExprNode { return this.binaryLevel(['+', '-'], () => this.multiplicative()); }
  private multiplicative(): ExprNode { return this.binaryLevel(['*', '/', '%'], () => this.unary()); }

  private unary(): ExprNode {
    const t = this.peek();
    if (t.t === 'op' && (t.v === '!' || t.v === '-' || t.v === '+')) {
      this.i++;
      this.enter(t.p);
      try { return { k: 'unary', op: t.v, arg: this.unary(), p: t.p }; } finally { this.leave(); }
    }
    if (t.t === 'op' && (t.v === '++' || t.v === '--' || t.v === '~')) throw this.unexpected(t);
    return this.postfix();
  }

  private postfix(): ExprNode {
    let n = this.primary();
    for (;;) {
      const t = this.peek();
      if (t.t !== 'op') return n;
      if (t.v === '.' || t.v === '?.') {
        this.i++;
        const optional = t.v === '?.';
        if (optional && this.isOp('(')) throw disallowed('an optional call', t.p);
        if (optional && this.eatOp('[')) {
          const prop = this.computedKey(t.p);
          n = { k: 'member', obj: n, prop, optional: true, p: t.p };
          continue;
        }
        const name = this.next();
        if (name.t !== 'id') throw syntax('expected a property name', name.p);
        if (BLOCKED_KEYS.has(name.v)) throw disallowed(`access to ${name.v}`, name.p);
        n = { k: 'member', obj: n, prop: name.v, optional, p: name.p };
        continue;
      }
      if (t.v === '[') {
        this.i++;
        n = { k: 'member', obj: n, prop: this.computedKey(t.p), optional: false, p: t.p };
        continue;
      }
      if (t.v === '(') {
        if (n.k === 'member' && typeof n.prop === 'string' && !n.paren) {
          if (!STRING_METHODS.has(n.prop) && !ARRAY_METHODS.has(n.prop)) throw disallowed(`call to ${n.prop}`, t.p);
          this.i++;
          n = { k: 'call', recv: n.obj, name: n.prop, args: this.args(), optional: n.optional, p: t.p };
          continue;
        }
        if (n.k === 'id') throw disallowed(`call to ${n.name}`, t.p);
        if (n.k === 'member' && typeof n.prop !== 'string' && !n.paren) throw disallowed('a computed method call', t.p);
        throw disallowed('a function call', t.p);
      }
      if (t.v === '++' || t.v === '--') throw this.unexpected(t);
      return n;
    }
  }

  /** `[expr]` after `[` or `?.[`; a literal blocked key is rejected here, a computed one at evaluation. */
  private computedKey(p: number): ExprNode {
    const prop = this.expr();
    this.expectOp(']');
    if (prop.k === 'lit' && typeof prop.v === 'string' && BLOCKED_KEYS.has(prop.v)) throw disallowed(`access to ${prop.v}`, p);
    return prop;
  }

  private args(): ExprNode[] {
    const out: ExprNode[] = [];
    if (this.eatOp(')')) return out;
    for (;;) {
      if (this.isOp('...')) throw disallowed('spread', this.peek().p);
      out.push(this.expr());
      if (this.eatOp(')')) return out;
      this.expectOp(',');
    }
  }

  private primary(): ExprNode {
    const t = this.next();
    if (t.t === 'num' || t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'id') {
      if (t.v === 'true') return { k: 'lit', v: true };
      if (t.v === 'false') return { k: 'lit', v: false };
      if (t.v === 'null') return { k: 'lit', v: null };
      if (t.v === 'undefined') return { k: 'lit', v: undefined };
      const kw = KEYWORD_CONSTRUCTS.get(t.v);
      if (kw) throw disallowed(kw, t.p);
      if (this.isOp('=>')) throw disallowed('an arrow function', this.peek().p);
      return { k: 'id', name: t.v, p: t.p };
    }
    if (t.t === 'eof') throw syntax('unexpected end of expression', t.p);
    if (t.t === 'op') {
      if (t.v === '(') {
        if (this.isOp(')')) throw disallowed('an arrow function', t.p);
        const inner = this.expr();
        this.expectOp(')');
        if (this.isOp('=>')) throw disallowed('an arrow function', this.peek().p);
        return inner.k === 'member' || inner.k === 'call' ? { ...inner, paren: true } : inner;
      }
      if (t.v === '[') {
        const items: ExprNode[] = [];
        if (this.eatOp(']')) return { k: 'arr', items };
        for (;;) {
          if (this.isOp('...')) throw disallowed('spread', this.peek().p);
          items.push(this.expr());
          if (this.eatOp(']')) return { k: 'arr', items };
          this.expectOp(',');
        }
      }
      if (t.v === '{') return this.objectLiteral();
      if (t.v === '/') throw disallowed('a regex literal', t.p);
    }
    throw this.unexpected(t);
  }

  private objectLiteral(): ExprNode {
    const props: Array<{ key: string; value: ExprNode }> = [];
    if (this.eatOp('}')) return { k: 'obj', props };
    for (;;) {
      const k = this.next();
      if (k.t === 'op' && k.v === '...') throw disallowed('spread', k.p);
      if (k.t === 'op' && k.v === '[') throw disallowed('a computed key', k.p);
      if (k.t !== 'id' && k.t !== 'str') throw syntax('expected a property name', k.p);
      if (BLOCKED_KEYS.has(k.v)) throw disallowed(`access to ${k.v}`, k.p);
      this.expectOp(':');
      props.push({ key: k.v, value: this.expr() });
      if (this.eatOp('}')) return { k: 'obj', props };
      this.expectOp(',');
    }
  }
}

function stripWrapper(expr: string): string {
  const t = expr.trim();
  return t.startsWith('{{') && t.endsWith('}}') ? t.slice(2, -2).trim() : t;
}

export function parseExpression(expr: string): ExprNode {
  const src = stripWrapper(expr);
  if (src.length > MAX_EXPRESSION_LENGTH) {
    throw disallowed(`an expression longer than ${MAX_EXPRESSION_LENGTH} characters`, MAX_EXPRESSION_LENGTH);
  }
  if (!src) throw syntax('empty expression', 0);
  return new Parser(tokenize(src)).parseAll();
}

export function validateExpression(expr: string): ExpressionError | null {
  try {
    parseExpression(expr);
    return null;
  } catch (e) {
    if (isExpressionError(e)) return e;
    throw e;
  }
}

const SHORT: unique symbol = Symbol('optional-chain-short-circuit');

/** Own data property only: never inherited, never an accessor, and never a
 * function value — a function read out of scope data would let a caller
 * invoke it (directly, or indirectly via implicit coercions like `+`, `==`,
 * `String()`, array `join`), which is code execution through data. */
function ownData(obj: object, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(obj, key);
  if (!d || !('value' in d)) return undefined;
  return typeof d.value === 'function' ? undefined : d.value;
}

/** True canonical index check: '01', '1.0', '+1', etc. are never treated as
 * indices, matching how real arrays name their own integer-index keys. */
function isCanonicalIndex(key: string): boolean {
  const n = Number(key);
  return Number.isInteger(n) && n >= 0 && String(n) === key;
}

function isPlainObject(o: object): boolean {
  const proto = Object.getPrototypeOf(o);
  return proto === Object.prototype || proto === null;
}

function isPlainArray(o: object): o is unknown[] {
  return Array.isArray(o) && Object.getPrototypeOf(o) === Array.prototype;
}

/** The shape of every value our sandbox is willing to hand back from a read
 * (scope-root identifier or object/array member): a primitive (including
 * `null`), a plain object (`Object.prototype` or null prototype), or a real
 * array (`Array.prototype` exactly). Anything else — a class instance, a
 * boxed primitive, an Array subclass, `Map`, `Date`, a `Proxy`, or a function
 * — becomes `undefined`.
 *
 * This does NOT sanitize what's inside a plain object or array it lets
 * through: a plain object handed back here can still carry a real function
 * on one of its own properties (set by the host, not synthesized by this
 * evaluator), and the value itself is returned whole, not walked. That's
 * fine, because reading it is not where the risk is — the risk is a native
 * operator implicitly coercing it (calling its `toString`/`valueOf`/
 * `Symbol.toPrimitive`). Every such coercion site uses `prim()` below, which
 * refuses ANY object or function outright, so that internal machinery is
 * never reached, regardless of how deep or well-hidden it is.
 *
 * Hosts must pass plain data. The actual residual: a `Proxy` placed in
 * scope, at any depth, may still have its `getPrototypeOf` trap invoked by
 * this classification, and its `getOwnPropertyDescriptor` trap invoked by
 * every own-data read (`ownData`, `ownIndexDescriptor`, `ownIndexLength`) —
 * those two traps run before we can tell the value isn't a plain object or
 * array, or before we can read one own property or the array length. No
 * other trap is ever reached (`get`, `has`, `set`, `ownKeys`, `apply`, ...):
 * no value that can originate from scope is ever the target of an ordinary
 * property read (`x.y`, `x[k]`, `x.length`, destructuring, spread, `in`,
 * iteration) or a method lookup; array `length` included, which is read
 * through `ownIndexLength`. Whatever a trap reports back is only returned
 * after `dataValue` has classified it, so a trap can run its own (host) code
 * but can never hand back a function, nor an object dataValue classifies as
 * neither plain object nor array. It CAN hand back the Proxy itself, whole
 * and unwalked, when its own getPrototypeOf trap reports `Object.prototype`
 * or `Array.prototype`: dataValue only checks the prototype, so a Proxy
 * classified as plain data this way is indistinguishable from real plain
 * data and is returned to the expression (and, if it's the whole result, to
 * the caller) exactly as `readProp`/`ownData` etc. would return real plain
 * data — the evaluator runs nothing further on it beyond that. Hosts must
 * pass plain data; a Proxy in scope is trusted to report its own shape
 * honestly, not sandboxed against lying. */
function dataValue(v: unknown): unknown {
  if (typeof v === 'function') return undefined;
  if (v === null || typeof v !== 'object') return v;
  return isPlainArray(v) || isPlainObject(v) ? v : undefined;
}

/** Reads own data from plain objects (`Object.prototype` or null prototype)
 * and real arrays only, then applies the same `dataValue` classification to
 * the result — so a nested class instance, Map, Date, Proxy, etc. read as
 * undefined exactly like one at the scope root, no matter how deep it is. */
function readProp(obj: unknown, key: string, p: number): unknown {
  if (BLOCKED_KEYS.has(key)) throw disallowed(`access to ${key}`, p);
  return dataValue(readOwnMember(obj, key));
}

/** readProp's raw lookup; its result is never returned without `dataValue`.
 * `obj.length`/`obj.charAt` below run only on a primitive string. An array's
 * `length` is read as an own data descriptor (`ownIndexLength`), never with
 * `obj.length`: `isPlainArray` accepts a Proxy over a real array, and a
 * `.length` read on that would run its `get` trap. */
function readOwnMember(obj: unknown, key: string): unknown {
  if (typeof obj === 'string') {
    if (key === 'length') return obj.length;
    return isCanonicalIndex(key) && Number(key) < obj.length ? obj.charAt(Number(key)) : undefined;
  }
  if (obj === null || typeof obj !== 'object') return undefined;
  if (isPlainArray(obj)) return key === 'length' ? ownIndexLength(obj) : ownData(obj, key);
  if (isPlainObject(obj)) return ownData(obj, key);
  return undefined;
}

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'an array';
  const t = typeof v;
  return t === 'object' ? 'an object' : `a ${t}`;
}

type Prim = string | number | boolean | null | undefined | bigint;

/** The one gate every coercion site goes through: an object, a function, or
 * a symbol is refused outright — never handed to a native operator that
 * might call `toString`/`valueOf`/`Symbol.toPrimitive` on it. This is what
 * actually closes function-smuggling, structurally: it doesn't matter WHERE
 * a live function is hiding (a scope-root value, a nested property, an
 * object literal built inside the expression) if no coercion site is ever
 * allowed to touch anything but an already-primitive value. */
function prim(v: unknown, p: number, what: string): Prim {
  if (v === null) return v;
  const t = typeof v;
  if (t === 'object' || t === 'function' || t === 'symbol') {
    throw new ExpressionError(`${what} needs a plain value, not ${describeType(v)}`, 'evaluation error', p);
  }
  return v as Prim;
}

function propKey(v: unknown, p: number): string {
  const pv = prim(v, p, 'a computed property key');
  return typeof pv === 'string' ? pv : String(pv);
}

/** Own `length`, read as a data descriptor only; never `a.length`, which on
 * a Proxy over an array would run its `get` trap. Anything but a non-negative
 * safe integer (missing, an accessor, a function, `NaN`, negative, fractional;
 * only a Proxy's `getOwnPropertyDescriptor` trap can report those on a real
 * array) reads as 0. */
function ownIndexLength(a: unknown[]): number {
  const d = Object.getOwnPropertyDescriptor(a, 'length');
  if (!d || !('value' in d)) return 0;
  const v: unknown = d.value;
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0;
}

/** The most indices any array method below will visit. JSON-shaped data is
 * dense, so a longer array is almost certainly a host-built sparse one
 * (`a.length = 1e9`) that would otherwise pin the thread in a scan. */
export const MAX_ARRAY_SCAN = 1_000_000;

/** `ownIndexLength`, refusing (as an evaluation error) an array longer than
 * `MAX_ARRAY_SCAN` before any method starts walking it. */
function scanLength(a: unknown[], name: string, p: number): number {
  const len = ownIndexLength(a);
  if (len > MAX_ARRAY_SCAN) {
    throw new ExpressionError(
      `${name} on an array longer than ${MAX_ARRAY_SCAN} elements is not allowed in a workflow expression`,
      'evaluation error',
      p,
    );
  }
  return len;
}

/** The own property descriptor at an index; `undefined` for a hole. Never an
 * inherited property, and never a getter invocation (a descriptor read does
 * not call `get`). */
function ownIndexDescriptor(a: unknown[], i: number): PropertyDescriptor | undefined {
  return Object.getOwnPropertyDescriptor(a, String(i));
}

/** Own numeric-index data value only. A hole (no own property at that index)
 * and an index getter both read as `undefined`, and a getter is never invoked
 * to find that out: `'value' in d` is false for both, so neither case ever
 * touches `d.get`. */
function ownIndex(a: unknown[], i: number): unknown {
  const d = ownIndexDescriptor(a, i);
  return d && 'value' in d ? d.value : undefined;
}

/** ToIntegerOrInfinity on an already-prim-gated value: NaN/±0 -> 0, infinite
 * stays infinite, otherwise truncated toward zero — exactly the built-in
 * array methods' own argument normalization, reimplemented so we never call
 * anything the built-ins would call on our behalf. */
function toIntegerOrInfinity(v: Prim): number {
  const n = Number(v);
  if (Number.isNaN(n) || n === 0) return 0;
  if (!Number.isFinite(n)) return n;
  const t = Math.trunc(n);
  // Math.trunc(-0.5) is -0; the spec's ToIntegerOrInfinity yields +0.
  return t === 0 ? 0 : t;
}

function sameValueZero(x: unknown, y: unknown): boolean {
  return x === y || (typeof x === 'number' && typeof y === 'number' && Number.isNaN(x) && Number.isNaN(y));
}

/** Every array method below is hand-rolled over `ownIndexLength`/`ownIndex`
 * instead of calling anything on the receiver (`recv.slice`, `recv.join`,
 * `Array.prototype.slice.call(recv, …)`, …). That distinction matters: the
 * receiver is real, host-supplied scope data, and could carry its own
 * `join`/`slice`/`map`/`includes`/`indexOf` own-data properties (shadowing
 * the prototype method with a live function), or, for slice specifically,
 * calling the real `Array.prototype.slice` would let its `ArraySpeciesCreate`
 * step read `recv.constructor` and `constructor[Symbol.species]` — both are
 * live property reads on host data. Reading `length` and each index only via
 * `Object.getOwnPropertyDescriptor` sidesteps both risks entirely: no method
 * lookup on the receiver, no species construction, ever. */
function arraySlice(a: unknown[], args: unknown[], p: number): unknown[] {
  const startArg = args.length > 0 ? prim(args[0], p, 'a slice argument') : undefined;
  const endArg = args.length > 1 ? prim(args[1], p, 'a slice argument') : undefined;
  const len = scanLength(a, 'slice', p);
  const relStart = startArg === undefined ? 0 : toIntegerOrInfinity(startArg);
  const k = relStart < 0 ? Math.max(len + relStart, 0) : Math.min(relStart, len);
  const relEnd = endArg === undefined ? len : toIntegerOrInfinity(endArg);
  const final = relEnd < 0 ? Math.max(len + relEnd, 0) : Math.min(relEnd, len);
  const count = Math.max(final - k, 0);
  const out: unknown[] = [];
  for (let j = 0; j < count; j++) out.push(dataValue(ownIndex(a, k + j)));
  return out;
}

function arrayJoin(a: unknown[], args: unknown[], p: number): string {
  const sepArg = args.length > 0 ? prim(args[0], p, 'the join separator') : undefined;
  const sep = sepArg === undefined ? ',' : String(sepArg);
  const len = scanLength(a, 'join', p);
  const parts: string[] = [];
  for (let i = 0; i < len; i++) {
    const e = ownIndex(a, i);
    if (e === undefined || e === null) {
      parts.push('');
      continue;
    }
    parts.push(String(prim(e, p, 'an array element passed to join')));
  }
  return parts.join(sep);
}

function arrayIncludes(a: unknown[], args: unknown[], p: number): boolean {
  const search = args[0];
  const fromArg = args.length > 1 ? prim(args[1], p, 'a fromIndex argument') : undefined;
  const len = scanLength(a, 'includes', p);
  const rel = fromArg === undefined ? 0 : toIntegerOrInfinity(fromArg);
  const from = rel < 0 ? Math.max(len + rel, 0) : rel;
  for (let i = from; i < len; i++) {
    // A hole reads as undefined here, as in native includes.
    if (sameValueZero(ownIndex(a, i), search)) return true;
  }
  return false;
}

function arrayIndexOf(a: unknown[], args: unknown[], p: number): number {
  const search = args[0];
  const fromArg = args.length > 1 ? prim(args[1], p, 'a fromIndex argument') : undefined;
  const len = scanLength(a, 'indexOf', p);
  const rel = fromArg === undefined ? 0 : toIntegerOrInfinity(fromArg);
  const from = rel < 0 ? Math.max(len + rel, 0) : rel;
  for (let i = from; i < len; i++) {
    // Native indexOf skips holes (HasProperty), so indexOf(undefined) never
    // matches one; an index getter is present, reads as undefined, never runs.
    const d = ownIndexDescriptor(a, i);
    if (d === undefined) continue;
    if (('value' in d ? d.value : undefined) === search) return i;
  }
  return -1;
}

/** `==`/`!=` never runs ToPrimitive: an object (or function) operand is
 * compared by identity instead of being coerced. Only genuinely primitive
 * operands ever get JavaScript's loose-equality coercions (`1 == '1'`). */
function looseEq(l: unknown, r: unknown): boolean {
  const lRef = l !== null && (typeof l === 'object' || typeof l === 'function');
  const rRef = r !== null && (typeof r === 'object' || typeof r === 'function');
  if (lRef || rRef) return l === r;
  // eslint-disable-next-line eqeqeq
  return l == r;
}

function callMethod(recv: unknown, name: string, args: unknown[], p: number): unknown {
  if (typeof recv === 'string' && STRING_METHODS.has(name)) {
    const fn: unknown = Reflect.get(String.prototype, name);
    if (typeof fn === 'function') {
      // Every String method here (includes/startsWith/endsWith/indexOf/slice/…)
      // coerces its argument(s) via ToString/ToNumber if given an object —
      // exactly the coercion prim() exists to block.
      const primArgs = args.map((a) => prim(a, p, `an argument to ${name}`));
      return Reflect.apply(fn, recv, primArgs);
    }
  }
  if (Array.isArray(recv) && Object.getPrototypeOf(recv) === Array.prototype && ARRAY_METHODS.has(name)) {
    // Hand-rolled, not `recv.<name>(...)` or `Reflect.apply(Array.prototype.<name>, recv, …)`:
    // see arraySlice's doc comment for why calling anything looked up on the
    // receiver (an own-data method override, or slice's own species lookup)
    // is exactly the coercion/execution risk this evaluator exists to close.
    if (name === 'join') return arrayJoin(recv, args, p);
    if (name === 'slice') return arraySlice(recv, args, p);
    if (name === 'includes') return arrayIncludes(recv, args, p);
    if (name === 'indexOf') return arrayIndexOf(recv, args, p);
  }
  const msg = `call to ${name} on ${describeType(recv)}`;
  // An allowlisted method name on the wrong receiver type is a data problem
  // (the expression is fine; the runtime value isn't shaped for it), not a
  // language-level violation — unlike a name that was never allowlisted.
  if (STRING_METHODS.has(name) || ARRAY_METHODS.has(name)) {
    throw new ExpressionError(`${msg} is not allowed in a workflow expression`, 'evaluation error', p);
  }
  throw disallowed(msg, p);
}

function toNum(v: Prim): number {
  return typeof v === 'number' ? v : Number(v);
}

class Evaluator {
  constructor(private readonly scope: Record<string, unknown>) {}

  run(n: ExprNode): unknown { return this.val(n); }

  private val(n: ExprNode): unknown {
    const v = this.ev(n);
    return v === SHORT ? undefined : v;
  }

  /** The object side of a member or call. Continues an optional chain (SHORT
   * propagates) unless the object was parenthesized, which ends the chain. */
  private chain(n: ExprNode): unknown {
    return (n.k === 'member' || n.k === 'call') && !n.paren ? this.ev(n) : this.val(n);
  }

  private ev(n: ExprNode): unknown {
    switch (n.k) {
      case 'lit': return n.v;
      case 'id': return dataValue(ownData(this.scope, n.name));
      case 'arr': return n.items.map((x) => this.val(x));
      case 'obj': {
        const o: Record<string, unknown> = {};
        for (const pr of n.props) o[pr.key] = this.val(pr.value);
        return o;
      }
      case 'member': {
        const o = this.chain(n.obj);
        if (o === SHORT) return SHORT;
        if (n.optional && (o === null || o === undefined)) return SHORT;
        const key = typeof n.prop === 'string' ? n.prop : propKey(this.val(n.prop), n.p);
        return readProp(o, key, n.p);
      }
      case 'call': {
        const r = this.chain(n.recv);
        if (r === SHORT) return SHORT;
        if (n.optional && (r === null || r === undefined)) return SHORT;
        return callMethod(r, n.name, n.args.map((a) => this.val(a)), n.p);
      }
      case 'unary': {
        const v = this.val(n.arg);
        if (n.op === '!') return !v;
        const pv = prim(v, n.p, `unary '${n.op}'`);
        return n.op === '-' ? -toNum(pv) : toNum(pv);
      }
      case 'cond': return this.val(n.test) ? this.val(n.yes) : this.val(n.no);
      case 'bin': return this.bin(n);
    }
  }

  private bin(n: Extract<ExprNode, { k: 'bin' }>): unknown {
    if (n.op === '&&') { const l = this.val(n.l); return l ? this.val(n.r) : l; }
    if (n.op === '||') { const l = this.val(n.l); return l ? l : this.val(n.r); }
    if (n.op === '??') { const l = this.val(n.l); return l === null || l === undefined ? this.val(n.r) : l; }
    const l = this.val(n.l);
    const r = this.val(n.r);
    switch (n.op) {
      case '+': {
        // Every arithmetic/relational site validates through prim() first —
        // never String(l)/String(r) or a native +/</>/etc. on a raw object.
        const lp = prim(l, n.p, "'+'");
        const rp = prim(r, n.p, "'+'");
        return typeof lp === 'string' || typeof rp === 'string' ? String(lp) + String(rp) : toNum(lp) + toNum(rp);
      }
      case '-': return toNum(prim(l, n.p, "'-'")) - toNum(prim(r, n.p, "'-'"));
      case '*': return toNum(prim(l, n.p, "'*'")) * toNum(prim(r, n.p, "'*'"));
      case '/': return toNum(prim(l, n.p, "'/'")) / toNum(prim(r, n.p, "'/'"));
      case '%': return toNum(prim(l, n.p, "'%'")) % toNum(prim(r, n.p, "'%'"));
      case '==': return looseEq(l, r);
      case '!=': return !looseEq(l, r);
      case '===': return l === r;
      case '!==': return l !== r;
      case '<': return (prim(l, n.p, "'<'") as number) < (prim(r, n.p, "'<'") as number);
      case '<=': return (prim(l, n.p, "'<='") as number) <= (prim(r, n.p, "'<='") as number);
      case '>': return (prim(l, n.p, "'>'") as number) > (prim(r, n.p, "'>'") as number);
      case '>=': return (prim(l, n.p, "'>='") as number) >= (prim(r, n.p, "'>='") as number);
      default: throw syntax(`unknown operator '${n.op}'`, 0);
    }
  }
}

/** A thrown value's text, read as data: a primitive is stringified (no user
 * code can run for one); an object contributes only an own string `message`
 * data property. Never `e.message` or `String(e)` on an object: a value a
 * host trap throws could carry a `message` getter or its own `toString`. */
function thrownDetail(e: unknown): string {
  if (e === null || (typeof e !== 'object' && typeof e !== 'function')) return String(e);
  const d = Object.getOwnPropertyDescriptor(e, 'message');
  return d && 'value' in d && typeof d.value === 'string' ? d.value : 'unknown error';
}

/** Evaluate an author-written workflow expression against a data scope.
 * Strips one surrounding {{ … }}. Throws ExpressionError when the text is not
 * in the language. Never executes the text as code. */
export function evaluateExpression(expr: string, scope: Record<string, unknown>): unknown {
  const ast = parseExpression(expr);
  try {
    return new Evaluator(scope).run(ast);
  } catch (e) {
    // Only an ExpressionError this module branded (via BRANDED, checked with
    // WeakSet#has — no trap runs) passes through unwrapped. Everything else
    // is wrapped here: a look-alike object (even one whose prototype IS
    // ExpressionError.prototype), a thrown Proxy whose getPrototypeOf trap
    // runs host code, or anything else a trap can hand back. This function
    // cannot itself throw anything but a genuine ExpressionError.
    if (isOwnExpressionError(e)) throw e;
    let detail = 'unknown error';
    try {
      detail = thrownDetail(e);
    } catch {
      // detail keeps its fallback value.
    }
    throw new ExpressionError(`the expression could not be evaluated: ${detail}`, 'evaluation error', 0);
  }
}
