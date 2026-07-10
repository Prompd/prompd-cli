/* Prompt-node source validation: a prompt node's source can be a file/package
 * ref (`source`) OR inline text (`rawPrompt`/`content`) — the same rule as
 * workflowValidator's validatePromptNode. The parser used to require the
 * `source` KEY to exist, rejecting valid inline-only nodes (canvas-authored
 * prompts with no .prmd attached) while letting key-present-but-empty nodes
 * through. */
import { parseWorkflow } from '../src/lib/workflowParser'

function flow(data: Record<string, unknown>): string {
  return JSON.stringify({
    version: '1.0',
    metadata: { id: 'f', name: 'f' },
    nodes: [{ id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data }],
    edges: [],
  })
}

function codes(json: string): string[] {
  return parseWorkflow(json).errors.map((e) => e.code)
}

describe('parseWorkflow prompt-node source rule', () => {
  it('accepts an inline-only prompt node (rawPrompt, no source key)', () => {
    expect(codes(flow({ label: 'Inline', rawPrompt: 'Summarize {{ input }}' }))).not.toContain('MISSING_PROMPT_SOURCE')
  })

  it('accepts an inline-only prompt node via content', () => {
    expect(codes(flow({ label: 'Inline', content: 'Summarize {{ input }}' }))).not.toContain('MISSING_PROMPT_SOURCE')
  })

  it('still accepts a file-sourced node (source key present)', () => {
    expect(codes(flow({ label: 'File', source: 'prompts/x.prmd' }))).not.toContain('MISSING_PROMPT_SOURCE')
  })

  it('keeps the empty-source escape hatch working (source: "" + rawPrompt)', () => {
    // The strategy planner emits source:'' alongside rawPrompt for back-compat.
    expect(codes(flow({ label: 'Planner', source: '', rawPrompt: '{{ sub_input }}' }))).not.toContain('MISSING_PROMPT_SOURCE')
  })

  it('still rejects a prompt node with no source of any kind', () => {
    expect(codes(flow({ label: 'Empty' }))).toContain('MISSING_PROMPT_SOURCE')
  })

  it('rejects whitespace-only inline text with no source key', () => {
    expect(codes(flow({ label: 'Blank', rawPrompt: '   ' }))).toContain('MISSING_PROMPT_SOURCE')
  })
})
