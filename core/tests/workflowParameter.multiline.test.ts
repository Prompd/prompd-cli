/* Parameter `multiline`: asks a host to render a string parameter as a text
 * area that keeps newlines. The parser keeps it on the parameter as written;
 * the validator rejects a value that is present but not a boolean. */
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

describe('workflow parameter multiline', () => {
  it('keeps multiline on the parsed parameter', () => {
    const parsed = parseWorkflow(flow([{ name: 'topics', type: 'string', multiline: true }]))
    expect(parsed.file.parameters?.[0]).toMatchObject({ name: 'topics', multiline: true })
  })

  it.each([
    ['absent', undefined],
    ['true', true],
    ['false', false],
  ])('accepts multiline %s', (_desc, multiline) => {
    expect(codes(flow([{ name: 'topics', type: 'string', multiline }]))).not.toContain('INVALID_PARAM_MULTILINE')
  })

  it.each([
    ['the string "true"', 'true'],
    ['a number', 1],
    ['null', null],
  ])('rejects multiline set to %s', (_desc, multiline) => {
    expect(codes(flow([{ name: 'topics', type: 'string', multiline }]))).toContain('INVALID_PARAM_MULTILINE')
  })
})
