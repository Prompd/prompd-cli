import { buildExpressionScope, evaluateTemplateExpression, executeWorkflow, toPlainData } from '../src/lib/workflowExecutor';
import { parseWorkflow } from '../src/lib/workflowParser';

const ctx = (over: Partial<{ nodeOutputs: Record<string, unknown>; variables: Record<string, unknown>; workflow: Record<string, unknown>; previous_output: unknown }> = {}) => ({
  nodeOutputs: {}, variables: {}, workflow: {}, previous_output: undefined, ...over,
});

describe('evaluateTemplateExpression', () => {
  it('returns non-template strings unchanged', () => {
    expect(evaluateTemplateExpression('plain text', ctx())).toBe('plain text');
    expect(evaluateTemplateExpression('a {{ b }} c', ctx())).toBe('a {{ b }} c');
  });
  it('evaluates comparisons and property paths', () => {
    expect(evaluateTemplateExpression('{{ classify.score > 0.5 }}', ctx({ nodeOutputs: { classify: { score: 0.7 } } }))).toBe(true);
    expect(evaluateTemplateExpression('{{ workflow.topic }}', ctx({ workflow: { topic: 'x' } }))).toBe('x');
    expect(evaluateTemplateExpression('{{ input }}', ctx({ previous_output: 'prev' }))).toBe('prev');
  });
  it('treats model output as data, never code (regression: value substitution RCE)', () => {
    let exited = false;
    const realExit = process.exit;
    process.exit = ((): never => { exited = true; throw new Error('exit called'); }) as typeof process.exit;
    try {
      // This payload is a good "is it ever treated as source text at all"
      // canary, but is NOT itself reachable as a live statement under the old
      // vulnerable code: substituting it in for `input` in `input == 'ok'`
      // built `return (""); process.exit(1); ("" == 'ok')` - the `process.exit`
      // call sat after a `return` statement, so it was dead code, unreachable
      // even by the old `new Function` path. It still must not execute here.
      const payload = '"); process.exit(1); ("';
      expect(evaluateTemplateExpression("{{ input == 'ok' }}", ctx({ previous_output: payload }))).toBe(false);
      expect(evaluateTemplateExpression('{{ step.text.length > 0 }}', ctx({ nodeOutputs: { step: { text: payload } } }))).toBe(true);

      // This second payload IS live under the old code: substituting it in
      // for `input` built `return ("" || process.exit(1) || "" == 'ok')`.
      // `||` binds looser than `==`, so that parses as
      // `("" || process.exit(1)) || ("" == 'ok')` - `""` is falsy, so
      // `process.exit(1)` was actually called (and, since it's the first
      // reachable statement of a live expression, is the strongest possible
      // regression canary). The new evaluator reads `input` as data - the
      // whole payload string - so this is nothing more than a failed string
      // comparison.
      const payload2 = '" || process.exit(1) || "';
      expect(evaluateTemplateExpression("{{ input == 'ok' }}", ctx({ previous_output: payload2 }))).toBe(false);
    } finally {
      process.exit = realExit;
    }
    expect(exited).toBe(false);
  });
  it('throws ExpressionError for disallowed constructs instead of returning false', () => {
    expect(() => evaluateTemplateExpression('{{ require("fs") }}', ctx())).toThrow(/call to require/);
    expect(() => evaluateTemplateExpression('{{ a = 1 }}', ctx())).toThrow(/assignment/);
  });
  it('lets extra (guardrail verdict fields) be read directly', () => {
    expect(evaluateTemplateExpression('{{ pass }}', ctx(), { pass: true })).toBe(true);
    expect(evaluateTemplateExpression('{{ score >= 0.8 && !rejected }}', ctx(), { score: 0.9, rejected: false })).toBe(true);
  });
});

describe('buildExpressionScope', () => {
  it('precedence: extra > nodeOutputs > variables > workflow params', () => {
    const s = buildExpressionScope(ctx({ workflow: { x: 'w' }, variables: { x: 'v' }, nodeOutputs: { x: 'n' } }), { x: 'e' });
    expect(s.x).toBe('e');
    const s2 = buildExpressionScope(ctx({ workflow: { x: 'w' }, variables: { x: 'v' }, nodeOutputs: { x: 'n' } }));
    expect(s2.x).toBe('n');
  });
  it('a __proto__ own key in data cannot pollute the scope prototype', () => {
    const hostile = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    const s = buildExpressionScope(ctx({ nodeOutputs: hostile }));
    expect(Object.getPrototypeOf(s)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

// Integration: executeWorkflow surfaces a describeExpressionFailure message
// and marks the node 'failed' instead of throwing arbitrary JS or silently
// returning false, for each node type that hosts a user-authored expression.

function flowJson(nodes: Array<Record<string, unknown>>, edges: Array<Record<string, unknown>> = []): string {
  return JSON.stringify({
    version: '1.0',
    metadata: { id: 'f', name: 'f' },
    nodes,
    edges,
  });
}

describe('executeWorkflow: expression failures per node type', () => {
  it('condition node: failed with "Condition on ..." message', async () => {
    const workflow = parseWorkflow(flowJson([
      {
        id: 'cond1',
        type: 'condition',
        position: { x: 0, y: 0 },
        data: {
          label: 'My Condition',
          conditions: [{ id: 'c1', expression: '{{ fetch("x") }}', target: 'x' }],
          default: '',
        },
      },
    ]));

    const result = await executeWorkflow(workflow, {});
    expect(result.trace.status).toBe('failed');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].nodeId).toBe('cond1');
    expect(result.errors[0].message).toMatch(/^Condition on "My Condition"/);
  });

  it('loop node: failed with "Loop condition on ..." message', async () => {
    const workflow = parseWorkflow(flowJson([
      {
        id: 'loop1',
        type: 'loop',
        position: { x: 0, y: 0 },
        data: {
          label: 'My Loop',
          loopType: 'for-each',
          items: '{{ fetch("x") }}',
          maxIterations: 3,
        },
      },
    ]));

    const result = await executeWorkflow(workflow, {});
    expect(result.trace.status).toBe('failed');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].nodeId).toBe('loop1');
    expect(result.errors[0].message).toMatch(/^Loop condition on "My Loop"/);
  });

  it('guardrail node: failed with "Guardrail on ..." message', async () => {
    // A seed prompt node feeds guard1's `previous_output` (the input the
    // guardrail validates) - a guardrail with no upstream input is not a
    // realistic workflow, and its previous_output-formatting path (unrelated
    // to expression evaluation) is not this task's concern.
    const workflow = parseWorkflow(flowJson([
      {
        id: 'seed',
        type: 'prompt',
        position: { x: 0, y: 0 },
        data: { label: 'Seed', rawPrompt: 'seed', sourceType: 'raw' },
      },
      {
        id: 'guard1',
        type: 'guardrail',
        position: { x: 0, y: 0 },
        data: {
          label: 'My Guardrail',
          systemPrompt: 'Validate the input',
          passExpression: '{{ fetch("x") }}',
        },
      },
    ], [
      { id: 'e1', source: 'seed', target: 'guard1' },
    ]));

    const result = await executeWorkflow(workflow, {}, {
      executePrompt: async () => '{"score": 0.9, "rejected": false}',
    });
    expect(result.trace.status).toBe('failed');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].nodeId).toBe('guard1');
    expect(result.errors[0].message).toMatch(/^Guardrail on "My Guardrail"/);
  });

  it('prompt node parameter resolution: failed with "Prompt on ..." message', async () => {
    const workflow = parseWorkflow(flowJson([
      {
        id: 'prompt1',
        type: 'prompt',
        position: { x: 0, y: 0 },
        data: {
          label: 'My Prompt',
          rawPrompt: 'Discuss {{ topic }}',
          sourceType: 'raw',
          parameters: { topic: '{{ fetch("x") }}' },
        },
      },
    ]));

    const result = await executeWorkflow(workflow, {}, {
      executePrompt: async () => 'unused - should fail before this is called',
    });
    expect(result.trace.status).toBe('failed');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].nodeId).toBe('prompt1');
    expect(result.errors[0].message).toMatch(/^Prompt on "My Prompt"/);
  });
});

// ============================================================================
// Fix Round 1 (review findings)
// ============================================================================

describe('Fix Round 1: guardrail node `response.*` parity', () => {
  it('passExpression can read response.<field>, bare verdict fields, and any other own field, all at once', async () => {
    const workflow = parseWorkflow(flowJson([
      {
        id: 'seed',
        type: 'prompt',
        position: { x: 0, y: 0 },
        data: { label: 'Seed', rawPrompt: 'seed', sourceType: 'raw' },
      },
      {
        id: 'guard1',
        type: 'guardrail',
        position: { x: 0, y: 0 },
        data: {
          label: 'My Guardrail',
          systemPrompt: 'Validate the input',
          // response.score (old nodeOutputs.response phrasing), score (bare
          // verdict field), and pass (an arbitrary extra field on the judge's
          // JSON reply) must all resolve.
          passExpression: '{{ response.score > 0.5 && score >= 0.8 && pass }}',
        },
      },
    ], [
      { id: 'e1', source: 'seed', target: 'guard1' },
    ]));

    const result = await executeWorkflow(workflow, {}, {
      executePrompt: async () => '{"score": 0.9, "pass": true}',
    });
    expect(result.errors).toHaveLength(0);
    expect(result.trace.status).not.toBe('failed');
    const guardOutput = result.nodeOutputs.guard1 as { rejected: boolean };
    expect(guardOutput.rejected).toBe(false);
  });
});

describe('Fix Round 1: fail-closed on a broken expression (no more fail-open)', () => {
  it('a prompt node\'s embedded guardrail.rejectionExpression fails the node instead of defaulting to accepted', async () => {
    const workflow = parseWorkflow(flowJson([
      {
        id: 'prompt1',
        type: 'prompt',
        position: { x: 0, y: 0 },
        data: {
          label: 'Guarded Prompt',
          rawPrompt: 'hello',
          sourceType: 'raw',
          guardrail: {
            enabled: true,
            rejectionExpression: '{{ fetch("x") }}',
          },
        },
      },
    ]));

    const result = await executeWorkflow(workflow, {}, {
      executePrompt: async () => 'some LLM output',
    });
    expect(result.trace.status).toBe('failed');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].nodeId).toBe('prompt1');
    // Node-type label for a plain "prompt" node falls back to the default
    // (capitalized node type) branch of kindOf.
    expect(result.errors[0].message).toMatch(/^Prompt on "Guarded Prompt"/);
  });

  it('a chat-agent node\'s loopCondition fails the node instead of looping forever open', async () => {
    const workflow = parseWorkflow(flowJson([
      {
        id: 'seed',
        type: 'prompt',
        position: { x: 0, y: 0 },
        data: { label: 'Seed', rawPrompt: 'seed', sourceType: 'raw' },
      },
      {
        id: 'agent1',
        type: 'chat-agent',
        position: { x: 0, y: 0 },
        data: {
          label: 'My Agent',
          agentSystemPrompt: 'You are a helpful assistant.',
          userInputEnabled: false,
          guardrailEnabled: false,
          loopMode: 'multi-turn',
          maxIterations: 3,
          minIterations: 0,
          loopCondition: '{{ fetch("x") }}',
        },
      },
    ], [
      { id: 'e1', source: 'seed', target: 'agent1' },
    ]));

    const result = await executeWorkflow(workflow, {}, {
      executePrompt: async () => 'seed output',
      onPromptExecute: async () => ({ success: true, response: 'plain text response, no tool call' }),
    });
    expect(result.trace.status).toBe('failed');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].nodeId).toBe('agent1');
    expect(result.errors[0].message).toMatch(/^Chat-agent on "My Agent"/);
  });
});

describe('Fix Round 1: loop-body errors are attributed to the body node, not the loop', () => {
  it('a prompt param expression error inside a loop body names that prompt node, not the loop', async () => {
    const workflow = parseWorkflow(flowJson([
      {
        id: 'loop1',
        type: 'loop',
        position: { x: 0, y: 0 },
        data: {
          label: 'My Loop',
          loopType: 'count',
          count: 1,
          maxIterations: 3,
        },
      },
      {
        id: 'body1',
        type: 'prompt',
        parentId: 'loop1',
        position: { x: 0, y: 0 },
        data: {
          label: 'Body Prompt',
          rawPrompt: 'Discuss {{ topic }}',
          sourceType: 'raw',
          parameters: { topic: '{{ fetch("x") }}' },
        },
      },
    ]));

    const result = await executeWorkflow(workflow, {}, {
      executePrompt: async () => 'unused - should fail before this is called',
    });
    expect(result.trace.status).toBe('failed');
    expect(result.errors).toHaveLength(1);
    // Attributed to the body prompt node, not "loop1"/"My Loop".
    expect(result.errors[0].nodeId).toBe('loop1')
    expect(result.errors[0].message).toMatch(/^Prompt on "Body Prompt"/);
    expect(result.errors[0].message).not.toMatch(/Loop condition/);
  });
});

describe('Fix Round 1 (minor): outputTransform ExpressionError passes through undescribed', () => {
  it('a code tool\'s outputTransform ExpressionError is attributed to the tool node, not wrapped in a generic message', async () => {
    const workflow = parseWorkflow(flowJson([
      {
        id: 'tool1',
        type: 'tool',
        position: { x: 0, y: 0 },
        data: {
          label: 'My Code Tool',
          toolType: 'code',
          codeSnippet: 'return 1',
          codeLanguage: 'javascript',
          outputTransform: '{{ fetch("x") }}',
        },
      },
    ]));

    const result = await executeWorkflow(workflow, {});
    expect(result.trace.status).toBe('failed');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].nodeId).toBe('tool1');
    // Attributed via describeExpressionFailure (kindOf('tool') -> 'Tool'),
    // not wrapped as "Code tool '...' failed: <message>".
    expect(result.errors[0].message).toMatch(/^Tool on "My Code Tool"/);
  });
});

describe('Fix Round 1: CLI evaluateTemplateExpression enables parseJsonStrings', () => {
  it('{{ classify.category }} navigates a fenced-JSON node output string', () => {
    const scope = ctx({ nodeOutputs: { classify: '```json\n{"category":"x"}\n```' } });
    expect(evaluateTemplateExpression('{{ classify.category }}', scope)).toBe('x');
  });

  it('a for-each loop over {{ previous_output.items }} (a JSON string) iterates each item', async () => {
    const workflow = parseWorkflow(flowJson([
      {
        id: 'seed',
        type: 'prompt',
        position: { x: 0, y: 0 },
        data: { label: 'Seed', rawPrompt: 'seed', sourceType: 'raw' },
      },
      {
        id: 'loop1',
        type: 'loop',
        position: { x: 0, y: 0 },
        data: {
          label: 'Items Loop',
          loopType: 'for-each',
          items: '{{ previous_output.items }}',
          maxIterations: 10,
        },
      },
    ], [
      { id: 'e1', source: 'seed', target: 'loop1' },
    ]));

    const result = await executeWorkflow(workflow, {}, {
      executePrompt: async () => '{"items": ["a", "b", "c"]}',
    });
    expect(result.errors).toHaveLength(0);
    const loopOutput = result.nodeOutputs.loop1 as { iterations: number; results: unknown[] }
    expect(loopOutput.iterations).toBe(3);
  });
});

// ============================================================================
// Final review fix wave
// ============================================================================

function chatAgentGuardFlow(guard: Record<string, unknown>) {
  return parseWorkflow(flowJson([
    { id: 'seed', type: 'prompt', position: { x: 0, y: 0 }, data: { label: 'Seed', rawPrompt: 'seed', sourceType: 'raw' } },
    {
      id: 'agent1',
      type: 'chat-agent',
      position: { x: 0, y: 0 },
      data: {
        label: 'My Agent',
        agentSystemPrompt: 'sys',
        userInputEnabled: false,
        guardrailEnabled: true,
        guardrailSystemPrompt: 'judge it',
        ...guard,
        loopMode: 'single-turn',
        maxIterations: 1,
        minIterations: 0,
      },
    },
  ], [{ id: 'e1', source: 'seed', target: 'agent1' }]));
}

async function runChatAgentGuard(guard: Record<string, unknown>, judge: string) {
  let agentRan = false;
  const result = await executeWorkflow(chatAgentGuardFlow(guard), {}, {
    executePrompt: async (p: string) => (p.startsWith('raw:') && p.includes('judge it') ? judge : 'seed output'),
    onPromptExecute: async () => { agentRan = true; return { success: true, response: 'agent reply' }; },
  });
  return { result, agentRan };
}

describe('C1: chat-agent guardrail expressions fail closed', () => {
  const verdict = '```json\n{"rejected": true, "score": 0.1}\n```';

  it.each([
    ['a disallowed passExpression', { guardrailPassExpression: '{{ fetch("x") }}' }],
    ['a disallowed rejectionExpression', { guardrailRejectionExpression: '{{ fetch("x") }}' }],
    ['a passExpression with an evaluation error', { guardrailPassExpression: '{{ input.score + {} }}' }],
  ])('%s fails the node and the agent never runs', async (_name, guard) => {
    const { result, agentRan } = await runChatAgentGuard(guard, verdict);
    expect(agentRan).toBe(false);
    expect(result.trace.status).toBe('failed');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].nodeId).toBe('agent1');
    expect(result.errors[0].message).toMatch(/^Chat-agent on "My Agent"/);
  });

  it('an expression that fails on the parsed verdict is not retried against the raw reply', async () => {
    // `.slice` on the parsed verdict object is an evaluation error; on the raw
    // reply string it would succeed. The JSON-parse fallback must not swallow
    // the first failure by re-evaluating against the raw string.
    const { result, agentRan } = await runChatAgentGuard(
      { guardrailRejectionExpression: "{{ response.slice(0, 3) === '```' }}" },
      verdict,
    );
    expect(agentRan).toBe(false);
    expect(result.trace.status).toBe('failed');
    expect(result.errors[0].message).toMatch(/^Chat-agent on "My Agent"/);
  });

  it('a disallowed expression still fails closed when the judge reply is not JSON', async () => {
    const { result, agentRan } = await runChatAgentGuard(
      { guardrailRejectionExpression: '{{ fetch("x") }}' },
      '{"rejected": true, oops}',
    );
    expect(agentRan).toBe(false);
    expect(result.trace.status).toBe('failed');
    expect(result.errors[0].message).toMatch(/^Chat-agent on "My Agent"/);
  });

  it('{{ response.rejected }} reads the verdict and rejects', async () => {
    const { result, agentRan } = await runChatAgentGuard({ guardrailRejectionExpression: '{{ response.rejected }}' }, verdict);
    expect(result.errors).toHaveLength(0);
    expect(agentRan).toBe(false);
    const out = result.nodeOutputs.agent1 as { rejected?: boolean };
    expect(out.rejected).toBe(true);
  });

  it('bare verdict fields and guardrail_response are readable too', async () => {
    const { result, agentRan } = await runChatAgentGuard(
      { guardrailRejectionExpression: '{{ rejected && guardrail_response.score < 0.5 }}' },
      verdict,
    );
    expect(result.errors).toHaveLength(0);
    expect(agentRan).toBe(false);
    expect((result.nodeOutputs.agent1 as { rejected?: boolean }).rejected).toBe(true);
  });

  it('a passing verdict lets the agent run', async () => {
    const { result, agentRan } = await runChatAgentGuard(
      { guardrailRejectionExpression: '{{ response.rejected }}' },
      '```json\n{"rejected": false, "score": 0.9}\n```',
    );
    expect(result.errors).toHaveLength(0);
    expect(agentRan).toBe(true);
  });
});

function codeThenConditionFlow(executionContext: 'isolated' | 'main', code: string, expression: string) {
  return parseWorkflow(flowJson([
    { id: 'code1', type: 'code', position: { x: 0, y: 0 }, data: { label: 'Code', language: 'javascript', executionContext, code } },
    {
      id: 'cond1',
      type: 'condition',
      position: { x: 0, y: 0 },
      data: { label: 'Cond', conditions: [{ id: 'c1', expression, target: 'big' }], default: 'small' },
    },
    { id: 'big', type: 'output', position: { x: 0, y: 0 }, data: { label: 'Big' } },
    { id: 'small', type: 'output', position: { x: 0, y: 0 }, data: { label: 'Small' } },
  ], [
    { id: 'e1', source: 'code1', target: 'cond1' },
    { id: 'e2', source: 'cond1', target: 'big', sourceHandle: 'c1' },
    { id: 'e3', source: 'cond1', target: 'small', sourceHandle: 'default' },
  ]));
}

function codeOnlyFlow(executionContext: 'isolated' | 'main', code: string) {
  return parseWorkflow(flowJson([
    { id: 'code1', type: 'code', position: { x: 0, y: 0 }, data: { label: 'My Code', language: 'javascript', executionContext, code } },
  ]));
}

describe('C2: code-node output is plain data expressions can read', () => {
  it.each(['isolated', 'main'] as const)('%s: a returned object is readable by a following condition', async (mode) => {
    const result = await executeWorkflow(codeThenConditionFlow(mode, 'return { total: 5 }', '{{ code1.total > 3 }}'), {});
    expect(result.errors).toHaveLength(0);
    expect(result.nodeOutputs.cond1).toMatchObject({ branch: 'c1' });
  });

  it.each(['isolated', 'main'] as const)('%s: a returned array is readable by a following condition', async (mode) => {
    const result = await executeWorkflow(
      codeThenConditionFlow(mode, 'return [1, 2, 3]', '{{ code1.length === 3 && code1.includes(2) }}'),
      {},
    );
    expect(result.errors).toHaveLength(0);
    expect(result.nodeOutputs.cond1).toMatchObject({ branch: 'c1' });
  });

  it.each(['isolated', 'main'] as const)('%s: a returned Date becomes its ISO string', async (mode) => {
    const result = await executeWorkflow(codeOnlyFlow(mode, 'return new Date(0)'), {});
    expect(result.errors).toHaveLength(0);
    expect(result.nodeOutputs.code1).toBe('1970-01-01T00:00:00.000Z');
  });

  it.each([
    ['isolated', 'return function () { return 1 }'],
    ['main', 'return function () { return 1 }'],
    ['isolated', 'const a = {}; a.self = a; return a'],
    ['main', 'const a = {}; a.self = a; return a'],
  ] as const)('%s: a non-serializable return (%s) becomes undefined with one warning, no throw', async (mode, code) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = await executeWorkflow(codeOnlyFlow(mode, code), {});
      expect(result.errors).toHaveLength(0);
      expect(result.nodeOutputs.code1).toBeUndefined();
      const named = warn.mock.calls.filter((c) => String(c[0]).includes('"My Code"'));
      expect(named).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('toPlainData', () => {
  it('passes primitives through and JSON-round-trips everything else', () => {
    expect(toPlainData('x')).toBe('x');
    expect(toPlainData(3)).toBe(3);
    expect(toPlainData(null)).toBeNull();
    expect(toPlainData(undefined)).toBeUndefined();
    const out = toPlainData({ a: [1, { b: 2 }] }) as { a: unknown[] };
    expect(out).toEqual({ a: [1, { b: 2 }] });
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(out.a)).toBe(Array.prototype);
    expect(toPlainData(new Date(0))).toBe('1970-01-01T00:00:00.000Z');
  });
  it('a function or circular value becomes undefined without throwing', () => {
    expect(toPlainData(() => 1)).toBeUndefined();
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(toPlainData(a)).toBeUndefined();
  });
});

describe('C2: code-tool output reaches outputTransform as plain data', () => {
  it.each(['isolated', 'main'] as const)('%s: outputTransform reads a returned object', async (mode) => {
    const workflow = parseWorkflow(flowJson([
      {
        id: 'tool1',
        type: 'tool',
        position: { x: 0, y: 0 },
        data: {
          label: 'Code Tool',
          toolType: 'code',
          codeSnippet: 'return { total: 5 }',
          codeLanguage: 'javascript',
          codeExecutionContext: mode,
          outputTransform: '{{ result.total * 2 }}',
        },
      },
    ]));
    const result = await executeWorkflow(workflow, {});
    expect(result.errors).toHaveLength(0);
    expect(result.nodeOutputs.tool1).toBe(10);
  });

  it.each(['isolated', 'main'] as const)('%s: a returned promise settles before normalizing', async (mode) => {
    const result = await executeWorkflow(
      codeThenConditionFlow(mode, 'return Promise.resolve({ total: 5 })', '{{ code1.total > 3 }}'),
      {},
    );
    expect(result.errors).toHaveLength(0);
    expect(result.nodeOutputs.cond1).toMatchObject({ branch: 'c1' });
  });
});
