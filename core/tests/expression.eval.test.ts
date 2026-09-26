import { evaluateExpression, ExpressionError } from '../src/lib/expression';
import * as core from '../src/index';

const scope = {
  input: 'Error: disk full',
  score: 0.9,
  rejected: false,
  pass: true,
  items: ['a', 'b', 'c'],
  n: 3,
  obj: { a: { b: 2 }, list: [1, 2] },
  nothing: null,
  loop_index: 2,
  key: 'constructor',
  protoKey: '__proto__',
};

const values: Array<[string, unknown]> = [
  ['{{ pass }}', true],
  ['score >= 0.8 && !rejected', true],
  ["input.includes('disk')", true],
  ["input.toLowerCase().startsWith('error')", true],
  ["input.slice(0, 5)", 'Error'],
  ["items.join('-')", 'a-b-c'],
  ['items.length', 3],
  ['input.length', 16],
  ['items[1]', 'b'],
  ["input[0]", 'E'],
  ['obj.a.b + 1', 3],
  ["obj['list'][1]", 2],
  ['obj.missing', undefined],
  ['missing', undefined],
  ['missing?.deep.chain', undefined],
  ['nothing?.x', undefined],
  ["nothing?.includes('x')", undefined],
  ['nothing ?? 5', 5],
  ['0 ?? 5', 0],
  ['n > 2 ? "big" : "small"', 'big'],
  ['"a" + 1', 'a1'],
  ['2 * 3 - 1', 5],
  ['7 % 4', 3],
  ['-n', -3],
  ['!nothing', true],
  ['1 == "1"', true],
  ['1 === "1"', false],
  ['[1, 2].includes(2)', true],
  ["({ a: 1 }).a", 1],
  ['loop_index < 5', true],
  ["items.indexOf('c')", 2],
  ["'  x '.trim()", 'x'],
];

describe('evaluateExpression — values', () => {
  it.each(values)('%s', (expr, expected) => { expect(evaluateExpression(expr, scope)).toEqual(expected); });
});

describe('evaluateExpression — runtime rejections', () => {
  it('rejects a computed key that equals a blocked name at evaluation time', () => {
    expect(() => evaluateExpression('obj[key]', scope)).toThrow(ExpressionError);
    expect(() => evaluateExpression('obj[protoKey]', scope)).toThrow(ExpressionError);
    expect(() => evaluateExpression("obj['con' + 'structor']", scope)).toThrow(ExpressionError);
  });
  it('allows a method only on the right receiver type', () => {
    expect(() => evaluateExpression('n.toFixed(2)', scope)).toThrow(/call to toFixed/);
    expect(() => evaluateExpression("items.toLowerCase()", scope)).toThrow(/call to toLowerCase on an array/);
    expect(() => evaluateExpression("n.includes(1)", scope)).toThrow(/call to includes on a number/);
    expect(() => evaluateExpression("obj.includes('x')", { obj: { includes: () => 'pwned' } })).toThrow(/call to includes on an object/);
  });
  it('never reads inherited or accessor properties', () => {
    expect(evaluateExpression('toString', {})).toBeUndefined();
    expect(evaluateExpression('obj.hasOwnProperty', { obj: {} })).toBeUndefined();
    let called = false;
    const withGetter = Object.defineProperty({}, 'x', { get: () => { called = true; return 1; }, enumerable: true });
    expect(evaluateExpression('o.x', { o: withGetter })).toBeUndefined();
    expect(called).toBe(false);
  });
  it('treats hostile data as data', () => {
    const payload = '"); process.exit(1); ("';
    expect(evaluateExpression("input == 'x'", { input: payload })).toBe(false);
    expect(evaluateExpression('input.includes("process")', { input: payload })).toBe(true);
  });
  it('wraps unexpected runtime failures as evaluation errors', () => {
    const sym = Symbol('s');
    try { evaluateExpression('-s', { s: sym }); throw new Error('expected a throw'); }
    catch (e) { expect(e).toBeInstanceOf(ExpressionError); expect((e as ExpressionError).construct).toBe('evaluation error'); }
  });
});

describe('package exports', () => {
  it('exposes the expression API from @prompd/core', () => {
    expect(typeof core.evaluateExpression).toBe('function');
    expect(typeof core.validateExpression).toBe('function');
    expect(typeof core.describeExpressionFailure).toBe('function');
    expect(typeof core.isExpressionError).toBe('function');
    expect(core.ExpressionError).toBe(ExpressionError);
  });
});
