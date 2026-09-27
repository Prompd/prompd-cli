import { buildExpressionScope, evaluateTemplateExpression, executeWorkflow } from '../src/lib/workflowExecutor';
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
