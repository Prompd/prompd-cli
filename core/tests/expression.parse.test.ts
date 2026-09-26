import { validateExpression, describeExpressionFailure, ExpressionError, isExpressionError } from '../src/lib/expression';

const ok = [
  '{{ pass }}', 'pass', 'score >= 0.8 && !rejected', 'a.b.c', 'a?.b', 'a?.[0]', "a['b']", 'a[0][1]',
  "input.includes('error')", "input?.toLowerCase().startsWith('x')", "[1, 2].join('-')", "{ a: 1, 'b': [2] }",
  'x ?? y', 'a ? b : c', '(a || b) && c', '-x + +y * 2 / 3 % 4', 'a === b', 'a !== b', 'a == b', 'a != b',
  'loop_index < 5', 'true', 'false', 'null', 'undefined', '1.5e3', '.5', '"a\\n\\u0041\\x41"', "{ new: 1 }",
];
const rejected: Array<[string, string]> = [
  ['fetch("x")', 'call to fetch'],
  ['a.b.fetch()', 'call to fetch'],
  ['a[0]()', 'a computed method call'],
  ['(a.includes)(1)', 'a function call'],
  ['a?.(1)', 'an optional call'],
  ['new Date()', "'new'"],
  ['typeof a', "'typeof'"],
  ['void 0', "'void'"],
  ['delete a.b', "'delete'"],
  ['a in b', "the 'in' operator"],
  ['a instanceof b', "'instanceof'"],
  ['a = 1', 'assignment'],
  ['a += 1', 'assignment'],
  ['a ??= 1', 'assignment'],
  ['(a = 1)', 'assignment'],
  ['a++', 'increment/decrement'],
  ['--a', 'increment/decrement'],
  ['a & b', 'a bitwise operator'],
  ['~a', 'a bitwise operator'],
  ['a << 1', 'a bitwise operator'],
  ['a ** 2', 'the exponent operator'],
  ['a, b', 'the comma operator'],
  ['a; b', 'a statement separator'],
  ['x => 1', 'an arrow function'],
  ['() => 1', 'an arrow function'],
  ['(x) => 1', 'an arrow function'],
  ['function () { return 1 }', 'a function expression'],
  ['`x`', 'a template literal'],
  ['/x/.test(s)', 'a regex literal'],
  ['[...a]', 'spread'],
  ['{ ...a }', 'spread'],
  ['this', "'this'"],
  ['a.__proto__', 'access to __proto__'],
  ['a.constructor', 'access to constructor'],
  ['a.prototype', 'access to prototype'],
  ["a['__proto__']", 'access to __proto__'],
  ['{ __proto__: a }', 'access to __proto__'],
  ["{ 'constructor': a }", 'access to constructor'],
  ['{ [k]: 1 }', 'a computed key'],
  ['constructor.constructor("return this")()', 'access to constructor'],
  ['[].slice.constructor', 'access to constructor'],
  ['a.toString()', 'call to toString'],
  ['a.includes?.(1)', 'an optional call'],
];

describe('validateExpression — allowed', () => {
  it.each(ok)('%s', (expr) => { expect(validateExpression(expr)).toBeNull(); });
});

describe('validateExpression — rejected constructs', () => {
  it.each(rejected)('%s -> %s', (expr, construct) => {
    const err = validateExpression(expr);
    expect(err).toBeInstanceOf(ExpressionError);
    expect(err?.construct).toBe(construct);
  });
});

describe('validateExpression — syntax and limits', () => {
  it('reports syntax errors with construct "syntax error" and a position', () => {
    for (const bad of ['a +', '(a', "'open", 'a b', '0x1', '', '{{  }}', 'a ? b', '@']) {
      const err = validateExpression(bad);
      expect(err?.construct).toBe('syntax error');
      expect(typeof err?.position).toBe('number');
    }
  });
  it('accepts 60-deep nesting and rejects 70-deep nesting', () => {
    expect(validateExpression('('.repeat(60) + '1' + ')'.repeat(60))).toBeNull();
    expect(validateExpression('('.repeat(70) + '1' + ')'.repeat(70))?.construct).toBe('nesting deeper than 64 levels');
    expect(validateExpression('!'.repeat(70) + 'a')?.construct).toBe('nesting deeper than 64 levels');
  });
  it('accepts 2,000 characters and rejects 2,001', () => {
    expect(validateExpression('a'.repeat(2000))).toBeNull();
    expect(validateExpression('a'.repeat(2001))?.construct).toBe('an expression longer than 2000 characters');
  });
  it('does not treat inherited Object.prototype names as known keywords', () => {
    expect(validateExpression('toString')).toBeNull();
    expect(validateExpression('hasOwnProperty')).toBeNull();
  });
});

describe('describeExpressionFailure / isExpressionError', () => {
  it('formats disallowed constructs and syntax errors', () => {
    const d = validateExpression('fetch("x")')!;
    expect(describeExpressionFailure('Condition', 'Check status', d))
      .toBe(`Condition on "Check status" can't run: call to fetch, which workflow expressions can't do (position ${d.position}).`);
    const s = validateExpression('a +')!;
    expect(describeExpressionFailure('Loop condition', 'Retry', s))
      .toBe(`Loop condition on "Retry" has an invalid expression: ${s.message} (position ${s.position}).`);
  });
  it('recognises errors by class and by name', () => {
    expect(isExpressionError(validateExpression('a='))).toBe(true);
    const foreign = new Error('x'); foreign.name = 'ExpressionError';
    expect(isExpressionError(foreign)).toBe(true);
    expect(isExpressionError(new Error('x'))).toBe(false);
  });
});
