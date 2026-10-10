/* Parameter `label`: an optional human-readable name a host shows in run forms
 * and pickers in place of `name`, which stays the template key. The parser
 * keeps it on the parameter as written; the validator rejects a label that is
 * present but not a non-empty string. */
import { parseWorkflow } from '../src/lib/workflowParser'

function flow(parameters: unknown[]): string {
  return JSON.stringify({
    version: '1.0',
    metadata: { id: 'f', name: 'f' },
    parameters,
    nodes: [{ id: 'start', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Start', triggerType: 'manual' } }],
    edges: [],
  })
}

function codes(json: string): string[] {
  return parseWorkflow(json).errors.map((e) => e.code)
}

describe('workflow parameter label', () => {
  it('keeps a label on the parsed parameter', () => {
    const parsed = parseWorkflow(flow([{ name: 'rivals', label: 'Competitors', type: 'string' }]))
    expect(parsed.file.parameters?.[0]).toMatchObject({ name: 'rivals', label: 'Competitors' })
  })

  it('accepts a parameter without a label', () => {
    expect(codes(flow([{ name: 'rivals', type: 'string' }]))).not.toContain('INVALID_PARAM_LABEL')
  })

  it('accepts a non-empty string label', () => {
    expect(codes(flow([{ name: 'rivals', label: 'Competitors', type: 'string' }]))).not.toContain('INVALID_PARAM_LABEL')
  })

  it.each([
    ['an empty string', ''],
    ['only whitespace', '   '],
    ['a number', 42],
    ['null', null],
  ])('rejects a label that is %s', (_desc, label) => {
    expect(codes(flow([{ name: 'rivals', label, type: 'string' }]))).toContain('INVALID_PARAM_LABEL')
  })
})
