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
      const payload = '"); process.exit(1); ("';
      expect(evaluateTemplateExpression("{{ input == 'ok' }}", ctx({ previous_output: payload }))).toBe(false);
      expect(evaluateTemplateExpression('{{ step.text.length > 0 }}', ctx({ nodeOutputs: { step: { text: payload } } }))).toBe(true);
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
