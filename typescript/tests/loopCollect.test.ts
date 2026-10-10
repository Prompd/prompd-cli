import { executeWorkflow, joinLoopResults } from '../src/lib/workflowExecutor';
import { parseWorkflow } from '../src/lib/workflowParser';
import { parseWorkflow as parseCoreWorkflow } from '@prompd/core';

/* Loop `collect: 'text'` hands on one readable string instead of the structured
 * { iterations, results, lastOutput } object - the same string the browser
 * runner (prompd-web src/workflows/run.ts) produces for the same file. */

describe('joinLoopResults', () => {
  it('joins string outputs with a blank line by default', () => {
    expect(joinLoopResults(['first', 'second'])).toBe('first\n\nsecond');
  });
  it('uses the given separator, including an empty one', () => {
    expect(joinLoopResults(['a', 'b'], '\n---\n')).toBe('a\n---\nb');
    expect(joinLoopResults(['a', 'b'], '')).toBe('ab');
  });
  it('renders non-strings as JSON and null as empty', () => {
    expect(joinLoopResults([{ x: 1 }, null, 2])).toBe('{"x":1}\n\n\n\n2');
  });
});

function loopFlow(loopData: Record<string, unknown>): string {
  return JSON.stringify({
    version: '1.0',
    metadata: { id: 'f', name: 'f' },
    parameters: [{ name: 'words', type: 'array' }],
    nodes: [
      { id: 'start', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Start', triggerType: 'manual' } },
      {
        id: 'each', type: 'loop', position: { x: 0, y: 1 },
        data: { label: 'Each', loopType: 'for-each', items: '{{ workflow.words }}', arraySource: '{{ workflow.words }}', itemVariable: 'w', body: ['say'], maxIterations: 10, ...loopData },
      },
      { id: 'say', type: 'transformer', parentId: 'each', position: { x: 1, y: 1 }, data: { label: 'Say', mode: 'template', template: 'item={{ w }}' } },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'each' }],
  });
}

describe('loop collect', () => {
  it("collect: 'text' makes the loop's output the joined iteration outputs", async () => {
    const result = await executeWorkflow(parseWorkflow(loopFlow({ collect: 'text', separator: '\n---\n' })), { words: ['alpha', 'beta'] });
    expect(result.errors).toEqual([]);
    expect(result.nodeOutputs.each).toBe('item=alpha\n---\nitem=beta');
  });

  it('without collect the loop keeps its structured result', async () => {
    const result = await executeWorkflow(parseWorkflow(loopFlow({})), { words: ['alpha', 'beta'] });
    expect(result.errors).toEqual([]);
    const out = result.nodeOutputs.each as { iterations: number; results: unknown[] };
    expect(out.iterations).toBe(2);
    expect(out.results).toEqual(['item=alpha', 'item=beta']);
  });

  it('the validator rejects an unknown collect mode', () => {
    const errors = parseCoreWorkflow(loopFlow({ collect: 'csv' })).errors ?? [];
    expect(errors.map((e) => e.code)).toContain('INVALID_LOOP_COLLECT');
  });
});
