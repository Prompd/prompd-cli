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

  it('evaluates a 900-deep member chain within the length limit without a stack overflow', () => {
    const expr = 'a' + '.b'.repeat(900);
    expect(expr.length).toBeLessThanOrEqual(2000);
    expect(evaluateExpression(expr, { a: {} })).toBeUndefined();
  });
});

describe('evaluateExpression — function values never read out of scope data', () => {
  function spy(): { fn: () => string; called: () => boolean } {
    let called = false;
    const fn = (): string => { called = true; return 'pwned'; };
    return { fn, called: () => called };
  }

  it('a bare function-valued identifier reads as undefined', () => {
    const s = spy();
    expect(evaluateExpression('f', { f: s.fn })).toBeUndefined();
    expect(s.called()).toBe(false);
  });

  it('a nested function-valued property reads as undefined', () => {
    const s = spy();
    expect(evaluateExpression('o.f', { o: { f: s.fn } })).toBeUndefined();
    expect(s.called()).toBe(false);
  });

  // Every probe below tries to smuggle the (unread, therefore undefined)
  // function value into a position where an implicit coercion or built-in
  // method might invoke it. Some now throw (wrapped as ExpressionError,
  // asserted elsewhere) because the resulting real object has no usable
  // toString/valueOf; what matters here is that the spy is NEVER called.
  const probes: Array<[string, Record<string, unknown>]> = [
    ["({ toString: f }) + ''", {}],
    ["({ valueOf: f }) == 'x'", {}],
    ['({ valueOf: f }) < 1', {}],
    ['-({ valueOf: f })', {}],
    ["[({ toString: f })].join()", {}],
    ["o[({ toString: f })]", { o: { a: 1 } }],
    ["s.slice(({ valueOf: f }))", { s: 'hello' }],
    ['s.includes(({ toString: f }))', { s: 'hello' }],
  ];

  it.each(probes)('%s never invokes the smuggled function', (expr, extraScope) => {
    const s = spy();
    try {
      evaluateExpression(expr, { f: s.fn, ...extraScope });
    } catch {
      // Throwing (wrapped as ExpressionError) is an acceptable outcome here —
      // only an actual call to the spy would be a security failure.
    }
    expect(s.called()).toBe(false);
  });
});

describe('evaluateExpression — reads restricted to plain objects and real arrays', () => {
  it('a class instance reads its own field as undefined', () => {
    const Point = class { x: number; constructor() { this.x = 1; } };
    expect(evaluateExpression('o.x', { o: new Point() })).toBeUndefined();
  });

  it('an Array-subclass receiver is refused for an allowlisted array method', () => {
    class MyArray extends Array {}
    const s = MyArray.from([1, 2, 3]);
    expect(() => evaluateExpression('s.slice(0)', { s })).toThrow(/call to slice/);
  });

  it('a null-prototype plain object still reads its own data', () => {
    const o: Record<string, unknown> = Object.assign(Object.create(null), { a: 1 });
    expect(evaluateExpression('o.a', { o })).toBe(1);
  });

  it('a boxed primitive reads as undefined rather than exposing its wrapper internals', () => {
    // eslint-disable-next-line no-new-wrappers
    const boxed: unknown = new String('hi');
    expect(evaluateExpression('o.length', { o: boxed })).toBeUndefined();
  });
});

describe('evaluateExpression — string indices are canonical only', () => {
  it("rejects a non-canonical numeric-looking key like '01'", () => {
    expect(evaluateExpression("s['01']", { s: 'ab' })).toBeUndefined();
    expect(evaluateExpression("s['0']", { s: 'ab' })).toBe('a');
    expect(evaluateExpression("s['1']", { s: 'ab' })).toBe('b');
  });
});

describe('evaluateExpression — receiver-type errors are evaluation errors, not language violations', () => {
  it('an allowlisted method name on the wrong receiver type is an evaluation error', () => {
    try {
      evaluateExpression('items.toLowerCase()', { items: ['a', 'b'] });
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      expect((e as ExpressionError).construct).toBe('evaluation error');
    }
    try {
      evaluateExpression('n.includes(1)', { n: 3 });
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      expect((e as ExpressionError).construct).toBe('evaluation error');
    }
  });

  it('a method name that was never allowlisted is rejected at parse time, before any receiver-type question arises', () => {
    // The parser rejects a non-allowlisted method name outright (it can't yet
    // know the receiver type); only an allowlisted name reaching callMethod
    // on the wrong receiver is the 'evaluation error' case above.
    try {
      evaluateExpression('n.toFixed(2)', { n: 3 });
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      expect((e as ExpressionError).construct).toBe('call to toFixed');
    }
  });
});

describe('evaluateExpression — round 2: objects supplied directly from scope are never coerced', () => {
  // Unlike round 1's probes (which built the carrier object INSIDE the
  // expression, so the smuggled function was already filtered to undefined
  // by the time it reached the carrier), these carriers come straight FROM
  // SCOPE with a real function already baked into an own property. A plain
  // object read out of scope is handed back whole (see dataValue's doc
  // comment) — the property fix is that no coercion site is ever allowed to
  // touch it, so its internal toString/valueOf/Symbol.toPrimitive can never
  // run no matter how it got there.
  function spy(): { fn: () => string; called: () => boolean } {
    let called = false;
    const fn = (): string => { called = true; return 'pwned'; };
    return { fn, called: () => called };
  }

  function makeScope(fn: () => string): Record<string, unknown> {
    return {
      t: { toString: fn },
      v: { valueOf: fn },
      p: { [Symbol.toPrimitive]: fn },
      s: 'abc',
      o: {},
      a: [{ toString: fn }],
      x: { y: { toString: fn } },
    };
  }

  const probes = [
    "t + ''",
    "p + ''",
    "v == 'x'",
    'v < 1',
    '-v',
    '+v',
    '[t].join()',
    'a.join()',
    'a.join(t)',
    'o[t]',
    's.includes(t)',
    's.indexOf(t)',
    's.slice(v)',
    "x.y + ''",
    "({ a: t }).a + ''",
  ];

  it.each(probes)('%s never invokes the scope-supplied function', (expr) => {
    const s = spy();
    try {
      evaluateExpression(expr, makeScope(s.fn));
    } catch (e) {
      // Throwing (wrapped as ExpressionError) is an acceptable outcome —
      // only an actual call to the spy would be a security failure.
      expect(e).toBeInstanceOf(ExpressionError);
    }
    expect(s.called()).toBe(false);
  });

  it('the same probes against a null-prototype carrier never invoke the function', () => {
    const s = spy();
    const nullProtoScope: Record<string, unknown> = {
      t: Object.assign(Object.create(null), { toString: s.fn }),
      v: Object.assign(Object.create(null), { valueOf: s.fn }),
    };
    for (const expr of ["t + ''", "v == 'x'", 'v < 1', '-v', '+v']) {
      try {
        evaluateExpression(expr, nullProtoScope);
      } catch (e) {
        expect(e).toBeInstanceOf(ExpressionError);
      }
    }
    expect(s.called()).toBe(false);
  });

  it('a class instance at the scope root reads as undefined', () => {
    const C = class { toString(): string { return 'class'; } };
    expect(evaluateExpression('c', { c: new C() })).toBeUndefined();
  });

  it('joining an array containing an undefined-read class instance never invokes it', () => {
    const C = class { toString(): string { return 'class'; } };
    expect(evaluateExpression('[c].join()', { c: new C() })).toBe('');
  });

  it('== / != compare object operands by identity, never by ToPrimitive', () => {
    const s = spy();
    const obj = { toString: s.fn };
    expect(evaluateExpression('obj == obj', { obj })).toBe(true);
    expect(evaluateExpression('obj != obj', { obj })).toBe(false);
    expect(evaluateExpression("obj == 'x'", { obj })).toBe(false);
    expect(evaluateExpression("obj != 'x'", { obj })).toBe(true);
    expect(s.called()).toBe(false);
  });

  it('array join over primitive elements still works', () => {
    expect(evaluateExpression("items.join('-')", { items: [1, 'a'] })).toBe('1-a');
  });

  it('string slice still works', () => {
    expect(evaluateExpression('s.slice(1)', { s: 'abc' })).toBe('bc');
  });

  it('array includes compares an object search value by identity (SameValueZero), never coerced', () => {
    const target = { a: 1 };
    expect(evaluateExpression('items.includes(target)', { items: [target], target })).toBe(true);
    expect(evaluateExpression('items.includes(target)', { items: [{ a: 1 }], target })).toBe(false);
  });
});

describe('evaluateExpression — the catch boundary never leaks a non-ExpressionError', () => {
  it('wraps a thrown null-prototype value from a scope read as an evaluation error', () => {
    // hasOwnProperty/getOwnPropertyDescriptor on a scope Proxy both dispatch to
    // its 'getOwnPropertyDescriptor' trap, so a plain identifier read against
    // this scope drives the throw through evaluateExpression's real catch
    // boundary — no scope getter or accessor path is involved.
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor(): PropertyDescriptor | undefined {
          throw Object.create(null);
        },
      },
    );
    try {
      evaluateExpression('x', hostile as Record<string, unknown>);
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      expect((e as ExpressionError).construct).toBe('evaluation error');
    }
  });

  it('wraps a host Error deceptively named ExpressionError', () => {
    const impostor = new Error('not really an ExpressionError');
    impostor.name = 'ExpressionError';
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor(): PropertyDescriptor | undefined {
          throw impostor;
        },
      },
    );
    try {
      evaluateExpression('x', hostile as Record<string, unknown>);
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      expect((e as ExpressionError).construct).toBe('evaluation error');
      expect((e as ExpressionError).message).toContain('not really an ExpressionError');
    }
  });
});
