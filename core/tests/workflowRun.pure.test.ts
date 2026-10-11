/* The workflow engine's pure helpers, moved from prompd-web. prompd-web's own
 * suites (flowFileRef, renderConversation, expressions, guardrailRun, runModel)
 * keep running against these through re-exports; this file pins core directly. */
import {
  substitute, renderConversation, resolveFlowFileRef, relativizeFlowRef, normalizeWorkspacePath,
  parseWorkflowJson, evalWorkflowCondition, parseVerdict, checkGuardrail, firstGuardrailHit,
  nodeToolNames, emptyRun, applyWfEvent, runTotals,
  WorkflowBlockedError, WorkflowNoWorkspaceError, isWorkflowBlockedError, isWorkflowNoWorkspaceError,
  type WfMessage, type WorkflowGuardrail, type WorkflowFile,
} from '../src/index'

describe('substitute', () => {
  it('fills tokens, blanks unknown keys, JSON-encodes objects', () => {
    expect(substitute('Hi {{ who }}, {{ missing }}{{ obj }}', { who: 'Bo', obj: { a: 1 } })).toBe('Hi Bo, {"a":1}')
  })
})

describe('renderConversation', () => {
  it('drops system, renders turns, tool calls and tool results', () => {
    const msgs: WfMessage[] = [
      { role: 'system', content: 'you are a bot' },
      { role: 'user', content: 'find X' },
      { role: 'assistant', content: 'searching', toolCalls: [{ id: 't1', name: 'web_search', arguments: '{}' }] },
      { role: 'tool', content: 'result text', toolCallId: 't1' },
      { role: 'assistant', content: 'here is X' },
    ]
    expect(renderConversation(msgs)).toBe(
      'user: find X\n\nassistant: searching\n\nassistant → web_search\n\n[tool] result text\n\nassistant: here is X',
    )
  })
})

describe('paths', () => {
  it('normalizes like the workspace does', () => {
    expect(normalizeWorkspacePath('.\\a\\b/')).toBe('a/b')
    expect(normalizeWorkspacePath('/x.prmd')).toBe('x.prmd')
  })
  it('resolves against the flow folder and round-trips', () => {
    expect(resolveFlowFileRef('workflows/t.pdflow', '../prompts/x.prmd')).toBe('prompts/x.prmd')
    expect(resolveFlowFileRef('workflows/t.pdflow', '/prompts/x.prmd')).toBe('prompts/x.prmd')
    expect(resolveFlowFileRef(null, './p/x.prmd')).toBe('p/x.prmd')
    const flow = 'advanced/workflows/test.pdflow'
    expect(resolveFlowFileRef(flow, relativizeFlowRef(flow, 'advanced/prompts/topic.prmd'))).toBe('advanced/prompts/topic.prmd')
  })
})

describe('parseWorkflowJson', () => {
  it('reports invalid JSON as an error string', () => {
    const r = parseWorkflowJson('{')
    expect(r.errors[0]).toMatch(/^Invalid JSON/)
  })
  it('drops disconnected warnings for off-chain provider and tool nodes', () => {
    const r = parseWorkflowJson(JSON.stringify({
      version: '1.0', metadata: { id: 'f', name: 'f' },
      nodes: [
        { id: 'pv', type: 'provider', position: { x: 0, y: 0 }, data: { label: 'pv', providerId: 'openai', model: 'm' } },
        { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 't' } },
        { id: 'o', type: 'output', position: { x: 0, y: 0 }, data: { label: 'o' } },
      ],
      edges: [{ id: 'e', source: 't', target: 'o' }],
    }))
    expect(r.parsed).not.toBeNull()
    expect(r.warnings.join('\n')).not.toMatch(/pv/)
  })
})

describe('evalWorkflowCondition', () => {
  it('blank is true; otherwise the safe evaluator decides', () => {
    expect(evalWorkflowCondition('', {})).toBe(true)
    expect(evalWorkflowCondition('{{ n > 1 }}', { n: 2 })).toBe(true)
    expect(evalWorkflowCondition('n > 1', { n: 0 })).toBe(false)
  })
})

describe('guardrails', () => {
  it('parseVerdict tolerates fences and prose', () => {
    expect(parseVerdict('```json\n{"pass":true}\n```')).toEqual({ pass: true })
    expect(parseVerdict('nope')).toEqual({ response: 'nope' })
  })
  it('checkGuardrail fails closed on an unreadable verdict', () => {
    expect(checkGuardrail({}, { response: 'x' }).pass).toBe(false)
    expect(checkGuardrail({ scoreThreshold: 0.5 }, { score: 0.7 }).pass).toBe(true)
  })
  it('firstGuardrailHit returns the first violation and skips disabled rules', async () => {
    const rules: WorkflowGuardrail[] = [
      { id: 'a', systemPrompt: 'a', action: 'warn', disabled: true },
      { id: 'b', systemPrompt: 'b', action: 'deny', passExpression: '{{ pass }}' },
      { id: 'c', systemPrompt: 'c', action: 'scrub' },
    ]
    const judged: string[] = []
    const hit = await firstGuardrailHit(rules, 'text', async (rule) => { judged.push(rule.id); return { pass: false } })
    expect(hit?.rule.id).toBe('b')
    expect(judged).toEqual(['b'])
  })
})

describe('nodeToolNames', () => {
  it('unions the node grant and attached Tools nodes', () => {
    const file = {
      version: '1.0', metadata: { id: 'f', name: 'f' }, edges: [],
      nodes: [
        { id: 'a', type: 'agent', position: { x: 0, y: 0 }, data: { label: 'a', tools: ['read_file'] } },
        { id: 'tl', type: 'tool', position: { x: 0, y: 0 }, data: { label: 'tl', attachedTo: 'a', tools: ['write_file', 'read_file'] } },
        { id: 'b', type: 'agent', position: { x: 0, y: 0 }, data: { label: 'b' } },
      ],
    } as unknown as WorkflowFile
    expect(nodeToolNames(file, 'a')).toEqual(['read_file', 'write_file'])
    expect(nodeToolNames(file, 'b')).toBeNull()
  })
})

describe('run model', () => {
  it('folds events into steps and totals', () => {
    let run = emptyRun(0)
    run = applyWfEvent(run, { type: 'node-start', id: 'p', nodeType: 'prompt', label: 'P' }, 1)
    run = applyWfEvent(run, { type: 'node-end', id: 'p', ms: 5, inTok: 10, outTok: 2 }, 6)
    run = applyWfEvent(run, { type: 'done', finalOutput: 'x' }, 7)
    expect(run.status).toBe('done')
    expect(runTotals(run)).toMatchObject({ count: 1, ok: 1, inTok: 10, outTok: 2 })
  })
})

describe('host errors', () => {
  it('are recognised by name, not instance', () => {
    expect(isWorkflowBlockedError(new WorkflowBlockedError('x'))).toBe(true)
    expect(isWorkflowBlockedError(new Error('x'))).toBe(false)
    expect(isWorkflowNoWorkspaceError(new WorkflowNoWorkspaceError('x'))).toBe(true)
    expect(isWorkflowNoWorkspaceError(Object.assign(new Error('x'), { name: 'WorkflowNoWorkspaceError' }))).toBe(true)
  })
})
