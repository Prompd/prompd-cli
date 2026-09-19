import { traceForkBranches, forkJoinId } from '../src/lib/parallel'
import { validateWorkflow } from '../src/lib/workflowValidator'
import type { WorkflowFile } from '../src/lib/workflowTypes'

const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } })

function flow(): WorkflowFile {
  return {
    version: '1.0',
    metadata: { id: 'f', name: 'f', description: '' },
    parameters: [],
    nodes: [
      node('t', 'trigger', { triggerType: 'manual' }),
      node('p', 'parallel', { mode: 'fork', forkCount: 3, forkLabels: ['Fast', 'Slow', 'Fast'], branches: [], waitFor: 'all', mergeStrategy: 'object' }),
      node('a1', 'transformer', { mode: 'template', template: 'a1' }),
      node('a2', 'transformer', { mode: 'template', template: 'a2' }),
      node('b1', 'transformer', { mode: 'template', template: 'b1' }),
      node('j', 'transformer', { mode: 'template', template: '{{ input }}' }),
      node('o', 'output'),
    ],
    edges: [
      { id: 'e0', source: 't', target: 'p' },
      { id: 'e1', source: 'p', target: 'b1', sourceHandle: 'fork-1' },
      { id: 'e2', source: 'p', target: 'a1', sourceHandle: 'fork-0' },
      { id: 'e3', source: 'a1', target: 'a2' },
      { id: 'e4', source: 'a2', target: 'j', targetHandle: 'input-0' },
      { id: 'e5', source: 'b1', target: 'j', targetHandle: 'input-1' },
      { id: 'e6', source: 'p', target: 'j', sourceHandle: 'fork-2', targetHandle: 'input-2' },
      { id: 'e7', source: 'j', target: 'o' },
    ],
  } as unknown as WorkflowFile
}

describe('traceForkBranches', () => {
  it('orders by fork index, follows chains, stops at input- handles, keeps empty branches', () => {
    expect(traceForkBranches(flow(), 'p')).toEqual([
      { key: 'Fast', label: 'Fast', nodeIds: ['a1', 'a2'] },
      { key: 'Slow', label: 'Slow', nodeIds: ['b1'] },
      { key: 'Fast (2)', label: 'Fast (2)', nodeIds: [] },
    ])
  })
  it('defaults labels to "Branch N"', () => {
    const f = flow()
    ;(f.nodes[1].data as unknown as Record<string, unknown>).forkLabels = undefined
    expect(traceForkBranches(f, 'p').map((b) => b.label)).toEqual(['Branch 1', 'Branch 2', 'Branch 3'])
  })
  it('stops at a merge node', () => {
    const f = flow()
    f.nodes.push(node('m', 'merge', { inputs: [], mergeAs: 'object' }) as never)
    f.edges = f.edges.map((e) => (e.id === 'e5' ? { id: 'e5', source: 'b1', target: 'm' } : e))
    expect(traceForkBranches(f, 'p')[1].nodeIds).toEqual(['b1'])
  })
  it('returns [] for a missing or non-parallel node', () => {
    expect(traceForkBranches(flow(), 'nope')).toEqual([])
    expect(traceForkBranches(flow(), 'a1')).toEqual([])
  })
})

describe('forkJoinId', () => {
  it('is the node the branches rejoin at', () => {
    expect(forkJoinId(flow(), 'p')).toBe('j')
  })
  it('is undefined when nothing rejoins', () => {
    const f = flow()
    f.edges = f.edges.filter((e) => !(e.targetHandle ?? '').startsWith('input-'))
    expect(forkJoinId(f, 'p')).toBeUndefined()
  })
})

describe('validator', () => {
  it('does not report a fork-mode parallel as an empty container', () => {
    const r = validateWorkflow(flow())
    expect(r.errors.filter((e) => e.code === 'EMPTY_CONTAINER')).toEqual([])
  })
  it('still reports an empty broadcast-mode parallel', () => {
    const f = flow()
    ;(f.nodes[1].data as unknown as Record<string, unknown>).mode = 'broadcast'
    expect(validateWorkflow(f).errors.some((e) => e.code === 'EMPTY_CONTAINER' && e.nodeId === 'p')).toBe(true)
  })
})
