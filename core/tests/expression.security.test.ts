import { evaluateExpression, validateExpression, ExpressionError } from '../src/lib/expression';

describe('evaluateExpression — additional security checks', () => {
  it('rejects an array-valued computed key that stringifies to a blocked name', () => {
    expect(() => evaluateExpression("obj[['constructor']]", { obj: {} })).toThrow(ExpressionError);
    expect(() => evaluateExpression("obj[['__proto__']]", { obj: {} })).toThrow(ExpressionError);
  });

  it('bare blocked identifiers read nothing from the scope prototype chain', () => {
    expect(evaluateExpression('constructor', {})).toBeUndefined();
    expect(evaluateExpression('__proto__', {})).toBeUndefined();
    expect(evaluateExpression('prototype', {})).toBeUndefined();
    // Own data is data — it can be read but never called, so this is safe.
    expect(evaluateExpression('constructor', { constructor: 5 })).toBe(5);
  });

  it('rejects escaped blocked string keys at validation time', () => {
    expect(validateExpression("a['__pro\\x74o__']")).toBeInstanceOf(ExpressionError);
    expect(validateExpression("{ 'con\\u0073tructor': 1 }")).toBeInstanceOf(ExpressionError);
  });

  it('rejects a backslash in an identifier', () => {
    expect(validateExpression('a.\\u0063onstructor')).toBeInstanceOf(ExpressionError);
  });

  it('parses "a?.5:1" as a ternary, not an optional-chain typo', () => {
    // '.' followed by a digit is unambiguously a number literal in this grammar
    // (property names can't start with a digit), so '?.5' tokenizes as the
    // ternary operator '?' followed by the number 0.5, never optional-chaining.
    expect(evaluateExpression('a?.5:1', { a: true })).toBe(0.5);
    expect(evaluateExpression('a?.5:1', { a: false })).toBe(1);
  });

  it('rejects nesting deeper than 64 levels through arrays, ternaries, and call args', () => {
    const arr = '['.repeat(70) + '1' + ']'.repeat(70);
    const arrErr = validateExpression(arr);
    expect(arrErr).toBeInstanceOf(ExpressionError);
    expect((arrErr as ExpressionError).construct).toBe('nesting deeper than 64 levels');

    const ternary = Array.from({ length: 70 }, () => '1?1:').join('') + '1';
    const ternaryErr = validateExpression(ternary);
    expect(ternaryErr).toBeInstanceOf(ExpressionError);
    expect((ternaryErr as ExpressionError).construct).toBe('nesting deeper than 64 levels');

    const calls = 's.includes('.repeat(70) + "'x'" + ')'.repeat(70);
    const callsErr = validateExpression(calls);
    expect(callsErr).toBeInstanceOf(ExpressionError);
    expect((callsErr as ExpressionError).construct).toBe('nesting deeper than 64 levels');
  });

  it('evaluates a 1,000-deep member chain within the length limit without a stack overflow', () => {
    const expr = 'a' + '.b'.repeat(900);
    expect(expr.length).toBeLessThanOrEqual(2000);
    expect(evaluateExpression(expr, { a: {} })).toBeUndefined();
  });
});
