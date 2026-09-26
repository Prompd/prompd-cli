/* Safe workflow expressions: a small JavaScript subset, parsed and evaluated
 * without ever executing the text as code. Shared by every workflow engine.
 * Spec: prompd-web/docs/superpowers/specs/2026-09-26-safe-workflow-expressions-design.md */

export class ExpressionError extends Error {
  readonly construct: string;
  readonly position: number;
  constructor(message: string, construct: string, position: number) {
    super(message);
    this.name = 'ExpressionError';
    this.construct = construct;
    this.position = position;
  }
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
  | { k: 'unary'; op: '!' | '-' | '+'; arg: ExprNode }
  | { k: 'bin'; op: string; l: ExprNode; r: ExprNode }
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
      l = { k: 'bin', op: t.v, l, r: nextLevel() };
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
      try { return { k: 'unary', op: t.v, arg: this.unary() }; } finally { this.leave(); }
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
