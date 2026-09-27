import { evaluateExpression, ExpressionError } from '../src/lib/expression';

describe('evaluateExpression: parseJsonStrings option', () => {
  it('is off by default: a named member access on a JSON string reads undefined', () => {
    const scope = { classify: '{"category":"x"}' };
    expect(evaluateExpression('{{ classify.category }}', scope)).toBeUndefined();
  });

  it('when on, reads a named key by JSON-parsing the string', () => {
    const scope = { classify: '{"category":"x"}' };
    expect(evaluateExpression('{{ classify.category }}', scope, { parseJsonStrings: true })).toBe('x');
  });

  it('strips a ```json fence before parsing', () => {
    const scope = { classify: '```json\n{"category":"x"}\n```' };
    expect(evaluateExpression('{{ classify.category }}', scope, { parseJsonStrings: true })).toBe('x');
  });

  it('strips a bare ``` fence (no "json" tag) before parsing', () => {
    const scope = { classify: '```\n{"category":"x"}\n```' };
    expect(evaluateExpression('{{ classify.category }}', scope, { parseJsonStrings: true })).toBe('x');
  });

  it('invalid JSON reads as undefined, never throws', () => {
    const scope = { classify: 'not json at all' };
    expect(evaluateExpression('{{ classify.category }}', scope, { parseJsonStrings: true })).toBeUndefined();
  });

  it('str.length is unaffected by the option (reads the string length, not a JSON key)', () => {
    const scope = { classify: '{"category":"x"}' };
    const off = evaluateExpression('{{ classify.length }}', scope);
    const on = evaluateExpression('{{ classify.length }}', scope, { parseJsonStrings: true });
    expect(off).toBe((scope.classify as string).length);
    expect(on).toBe((scope.classify as string).length);
  });

  it('a canonical numeric index still reads a string character, not a JSON array element', () => {
    const scope = { classify: '["a","b","c"]' };
    // classify[0] with parseJsonStrings on: numeric-index access on a string
    // reads the character, exactly as it does with the option off.
    expect(evaluateExpression('{{ classify[0] }}', scope)).toBe('[');
    expect(evaluateExpression('{{ classify[0] }}', scope, { parseJsonStrings: true })).toBe('[');
  });

  it('a JSON string with a __proto__/constructor key is still blocked, same as ordinary member access', () => {
    const scope = { classify: '{"__proto__":{"polluted":true},"constructor":1}' };
    expect(() => evaluateExpression('{{ classify.__proto__ }}', scope, { parseJsonStrings: true }))
      .toThrow(/access to __proto__/);
    expect(() => evaluateExpression('{{ classify.constructor }}', scope, { parseJsonStrings: true }))
      .toThrow(/access to constructor/);
    // And the option never lets JSON content actually repoint any prototype.
    try {
      evaluateExpression('{{ classify.__proto__ }}', scope, { parseJsonStrings: true });
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('navigates nested keys through a JSON string: a.b.c', () => {
    const scope = { data: '{"b":{"c":1}}' };
    expect(evaluateExpression('{{ data.b.c }}', scope, { parseJsonStrings: true })).toBe(1);
  });

  it('navigates an array through a JSON string: a.items[0], and a.items.length', () => {
    const scope = { data: '{"items":[10,20,30]}' };
    expect(evaluateExpression('{{ data.items[0] }}', scope, { parseJsonStrings: true })).toBe(10);
    expect(evaluateExpression('{{ data.items.length }}', scope, { parseJsonStrings: true })).toBe(3);
  });

  it('a top-level JSON-array string itself is not navigable by index/length (both are exempt from JSON parsing)', () => {
    // `.length`/canonical-index access always reads the string itself, per
    // spec, even when parseJsonStrings is on - so a bare array-shaped string
    // (not nested under a named key) has no reachable parsed form: `.length`
    // is the STRING's length, and `[0]` is its first character.
    const scope = { data: '[10,20,30]' };
    expect(evaluateExpression('{{ data.length }}', scope, { parseJsonStrings: true })).toBe('[10,20,30]'.length);
    expect(evaluateExpression('{{ data[0] }}', scope, { parseJsonStrings: true })).toBe('[');
  });
});
