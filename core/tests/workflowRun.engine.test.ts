/* The workflow engine driven by a fake host: one test per node type the engine
 * supports, plus unknown-type skip, abort, cost, model resolution and the
 * workflow-level scrub path. No network, no platform: the host is the only seam. */
import {
  runWorkflow, parseWorkflowJson, WorkflowBlockedError, WorkflowNoWorkspaceError,
  type WorkflowHost, type WfEvent, type WfMessage, type WfToolCall, type WfToolDef,
  type WfInputRequest, type WfUsage, type WfHealRecord,
} from '../src/index'

interface ModelReply { content: string; toolCalls?: WfToolCall[]; usage?: WfUsage }
type ModelFn = (messages: WfMessage[]) => ModelReply

interface Fake {
  host: WorkflowHost
  modelCalls: Array<{ model: string; messages: WfMessage[]; tools?: WfToolDef[] }>
  toolRuns: Array<{ call: WfToolCall; nodeId: string }>
  compiles: Array<{ src: { path: string } | { text: string }; vars: Record<string, unknown> }>
  inputs: WfInputRequest[]
  fetches: string[]
}

const READ_FILE: WfToolDef = { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: {} } }
const lastContent = (messages: WfMessage[]): string => messages[messages.length - 1]?.content ?? ''
const echo: ModelFn = (m) => ({ content: `echo:${lastContent(m)}` })

function fakeHost(over: Partial<WorkflowHost> = {}, model: ModelFn = echo): Fake {
  const modelCalls: Fake['modelCalls'] = []
  const toolRuns: Fake['toolRuns'] = []
  const compiles: Fake['compiles'] = []
  const inputs: WfInputRequest[] = []
  const fetches: string[] = []
  const host: WorkflowHost = {
    async callModel(req) {
      modelCalls.push({ model: req.model, messages: req.messages.map((m) => ({ ...m })), tools: req.tools })
      const r = model(req.messages)
      return { content: r.content, toolCalls: r.toolCalls ?? [], usage: r.usage }
    },
    toolsFor: () => [READ_FILE],
    async runTool(call, ctx) {
      toolRuns.push({ call, nodeId: ctx.nodeId })
      return { content: `ran ${call.name}` }
    },
    async compilePrompt(src, vars) {
      compiles.push({ src, vars })
      return 'path' in src ? `compiled ${src.path}` : src.text.replace('{{ policy }}', String(vars.policy))
    },
    async fetch(url) {
      fetches.push(url)
      return { status: 200, statusText: 'OK', text: 'pong' }
    },
    resolveModel: (nodeModel, workflowModel) => nodeModel || workflowModel || 'host-default',
    priceOf: () => null,
    async redactionPrompt() { return 'You are a redaction filter for {{ policy }}' },
    async requestInput(req) {
      inputs.push(req)
      return 'typed'
    },
    ...over,
  }
  return { host, modelCalls, toolRuns, compiles, inputs, fetches }
}

interface TestNode { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }
interface TestEdge { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }
const node = (id: string, type: string, data: Record<string, unknown> = {}): TestNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } })
const edge = (source: string, target: string, handles: { sourceHandle?: string; targetHandle?: string } = {}): TestEdge =>
  ({ id: `${source}->${target}`, source, target, ...handles })
const flow = (nodes: TestNode[], edges: TestEdge[], extra: Record<string, unknown> = {}): object =>
  ({ version: '1.0', metadata: { id: 'f', name: 'f' }, nodes, edges, ...extra })
const chain = (...nodes: TestNode[]): object => flow(nodes, nodes.slice(1).map((n, i) => edge(nodes[i].id, n.id)))
const T = (): TestNode => node('t', 'trigger')
const O = (): TestNode => node('o', 'output')

async function run(
  file: object, host: WorkflowHost, params: Record<string, unknown> = {},
  opts: { signal?: AbortSignal; flowPath?: string } = {},
): Promise<WfEvent[]> {
  const { parsed, errors } = parseWorkflowJson(JSON.stringify(file))
  if (!parsed) throw new Error(`test flow did not parse: ${errors.join('; ')}`)
  const events: WfEvent[] = []
  await runWorkflow(parsed, params, host, { ...opts, onEvent: (e) => { events.push(e) } })
  return events
}
function finalOutput(events: WfEvent[]): string | undefined {
  for (const e of events) if (e.type === 'done') return e.finalOutput
  return undefined
}
function nodeError(events: WfEvent[], id: string): string | undefined {
  for (const e of events) if (e.type === 'node-error' && e.id === id) return e.message
  return undefined
}
function skipReason(events: WfEvent[], id: string): string | undefined {
  for (const e of events) if (e.type === 'node-skip' && e.id === id) return e.reason
  return undefined
}
const notes = (events: WfEvent[], id: string): string[] =>
  events.flatMap((e) => (e.type === 'node-output' && e.id === id && e.note ? [e.output] : []))
const starts = (events: WfEvent[], id: string): number =>
  events.filter((e) => e.type === 'node-start' && e.id === id).length

describe('engine: trigger, transformer, output', () => {
  it('walks trigger -> transformer -> output and reports done', async () => {
    const f = fakeHost()
    const events = await run(chain(T(), node('x', 'transformer', { template: 'hello {{ who }}' }), O()), f.host, { who: 'Bo' })
    expect(notes(events, 't')).toEqual(['start'])
    expect(finalOutput(events)).toBe('hello Bo')
    expect(f.modelCalls).toHaveLength(0)
  })
})

describe('engine: prompt node', () => {
  it('inline: substitutes, calls the model with the default tool set, uses the host default model', async () => {
    const f = fakeHost()
    const events = await run(chain(T(), node('p', 'prompt', { rawPrompt: 'Say {{ who }}' }), O()), f.host, { who: 'Bo' })
    expect(f.modelCalls[0].model).toBe('host-default')
    expect(f.modelCalls[0].messages).toEqual([{ role: 'user', content: 'Say Bo' }])
    expect(f.modelCalls[0].tools).toEqual([READ_FILE])
    expect(finalOutput(events)).toBe('echo:Say Bo')
  })

  it('file: compiles the path resolved against the flow folder', async () => {
    const f = fakeHost()
    const events = await run(
      chain(T(), node('p', 'prompt', { sourceType: 'file', source: '../prompts/a.prmd' }), O()),
      f.host, {}, { flowPath: 'flows/f.pdflow' },
    )
    expect(f.compiles[0].src).toEqual({ path: 'prompts/a.prmd' })
    expect(f.compiles[0].vars).toMatchObject({ input: '' })
    expect(finalOutput(events)).toBe('echo:compiled prompts/a.prmd')
  })

  it('file with no workspace: skips with the workspace reason and the run continues', async () => {
    const f = fakeHost({ compilePrompt: async () => { throw new WorkflowNoWorkspaceError('no workspace') } })
    const events = await run(chain(T(), node('p', 'prompt', { sourceType: 'file', source: 'a.prmd' }), O()), f.host)
    expect(skipReason(events, 'p')).toMatch(/needs a workspace/)
    expect(finalOutput(events)).toBe('')
  })

  it('a compile failure is a node error', async () => {
    const f = fakeHost({ compilePrompt: async () => { throw new Error('bad include') } })
    const events = await run(chain(T(), node('p', 'prompt', { source: 'a.prmd' }), O()), f.host)
    expect(nodeError(events, 'p')).toBe('couldn\'t compile "a.prmd": bad include')
  })

  it('package ref: skipped, nothing compiled', async () => {
    const f = fakeHost()
    const events = await run(chain(T(), node('p', 'prompt', { source: 'acme/pack@1.0.0/x.prmd' }), O()), f.host)
    expect(skipReason(events, 'p')).toMatch(/needs the backend engine/)
    expect(f.compiles).toHaveLength(0)
  })

  it('provider node model goes through host.resolveModel; a node without one gets the default', async () => {
    const f = fakeHost()
    const file = flow(
      [node('pv', 'provider', { providerId: 'openai', model: 'gpt-x' }), T(),
        node('p', 'prompt', { rawPrompt: 'hi', providerNodeId: 'pv' }), node('q', 'prompt', { rawPrompt: 'yo' }), O()],
      [edge('t', 'p'), edge('p', 'q'), edge('q', 'o')],
    )
    await run(file, f.host)
    expect(f.modelCalls.map((c) => c.model)).toEqual(['gpt-x', 'host-default'])
  })

  it('a retry the host reports becomes today\'s in-run note and a heal record', async () => {
    const heals: WfHealRecord[] = []
    let retried = false
    const f = fakeHost({
      async callModel(req) {
        if (!retried) {
          retried = true
          req.onRetry?.({ attempt: 1, delayMs: 500, reason: 'upstream unavailable', maxRetries: 3 })
        }
        return { content: 'ok', toolCalls: [] }
      },
      onHeal: (rec) => { heals.push(rec) },
    })
    const events = await run(chain(T(), node('p', 'prompt', { rawPrompt: 'x' }), O()), f.host)
    expect(notes(events, 'p')).toEqual(['transient error — retrying (1/3)'])
    expect(heals).toEqual([{
      site: 'stream', kind: 'transient', strategy: 'retry-backoff', attempt: 1, outcome: 'retrying',
      error: 'upstream unavailable', model: 'host-default', nodeId: 'p',
    }])
    expect(finalOutput(events)).toBe('ok')
  })

  it('node-end carries tokens and the host-priced cost', async () => {
    const f = fakeHost({ priceOf: () => ({ input: 1, output: 2 }) }, () => ({ content: 'ok', usage: { inputTokens: 1_000_000, outputTokens: 500_000 } }))
    const events = await run(chain(T(), node('p', 'prompt', { rawPrompt: 'x' }), O()), f.host)
    const end = events.find((e) => e.type === 'node-end' && e.id === 'p')
    expect(end).toMatchObject({ inTok: 1_000_000, outTok: 500_000, cost: 2 })
  })
})

describe('engine: agent node and tools', () => {
  const toolThenFinal: ModelFn = (messages) => (messages.some((m) => m.role === 'tool')
    ? { content: 'final' }
    : { content: '', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"path":"a.md"}' }] })

  it('runs the tool round trip through the host', async () => {
    const f = fakeHost({}, toolThenFinal)
    const events = await run(chain(T(), node('a', 'agent', { userPrompt: 'go' }), O()), f.host)
    expect(f.toolRuns).toEqual([{ call: { id: 'c1', name: 'read_file', arguments: '{"path":"a.md"}' }, nodeId: 'a' }])
    expect(notes(events, 'a')).toContain('↳ read_file')
    expect(f.modelCalls[1].messages.slice(-2)).toEqual([
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"path":"a.md"}' }] },
      { role: 'tool', content: 'ran read_file', toolCallId: 'c1' },
    ])
    expect(finalOutput(events)).toBe('final')
  })

  it('a tool the node was not given is not run; the model is told it is unknown', async () => {
    const f = fakeHost({}, (messages) => (messages.some((m) => m.role === 'tool')
      ? { content: 'final' }
      : { content: '', toolCalls: [{ id: 'c1', name: 'nope', arguments: '{}' }] }))
    await run(chain(T(), node('a', 'agent', { userPrompt: 'go' }), O()), f.host)
    expect(f.toolRuns).toHaveLength(0)
    expect(f.modelCalls[1].messages[f.modelCalls[1].messages.length - 1]).toEqual({ role: 'tool', content: 'Unknown tool: nope', toolCallId: 'c1' })
  })

  it('a Tools node attached to the agent decides the names handed to host.toolsFor', async () => {
    const seen: Array<string[] | null> = []
    const f = fakeHost({ toolsFor: (names) => { seen.push(names); return [READ_FILE] } })
    const file = flow(
      [T(), node('a', 'agent', { userPrompt: 'go' }), node('tl', 'tool', { attachedTo: 'a', tools: ['write_file'] }), O()],
      [edge('t', 'a'), edge('a', 'o')],
    )
    await run(file, f.host)
    expect(seen).toEqual([['write_file']])
  })

  it('full-conversation output renders the transcript', async () => {
    const f = fakeHost({}, toolThenFinal)
    const events = await run(chain(T(), node('a', 'agent', { userPrompt: 'go', outputMode: 'full-conversation' }), O()), f.host)
    expect(finalOutput(events)).toBe('user: go\n\nassistant → read_file\n\n[tool] ran read_file\n\nassistant: final')
  })
})

describe('engine: guardrail node', () => {
  it('a failing verdict stops the run with the reason', async () => {
    const f = fakeHost({}, () => ({ content: '{"pass":false,"reason":"bad"}' }))
    const events = await run(chain(T(), node('x', 'transformer', { template: 'draft' }), node('g', 'guardrail'), O()), f.host)
    expect(nodeError(events, 'g')).toBe('guardrail rejected — bad')
    expect(finalOutput(events)).toBeUndefined()
  })

  it('a passing verdict lets the input through unchanged', async () => {
    const f = fakeHost({}, () => ({ content: '{"pass":true,"reason":"ok"}' }))
    const events = await run(chain(T(), node('x', 'transformer', { template: 'draft' }), node('g', 'guardrail'), O()), f.host)
    expect(notes(events, 'g')).toEqual(['guardrail passed — ok'])
    expect(f.modelCalls[0].messages[f.modelCalls[0].messages.length - 1]).toEqual({ role: 'user', content: 'draft' })
    expect(finalOutput(events)).toBe('draft')
  })
})

describe('engine: condition node', () => {
  const file = flow(
    [T(), node('c', 'condition', { conditions: [{ expression: '{{ n > 1 }}', target: 'big' }], default: 'small' }),
      node('big', 'transformer', { template: 'BIG' }), node('small', 'transformer', { template: 'SMALL' }), O()],
    [edge('t', 'c'), edge('big', 'o'), edge('small', 'o')],
  )
  it('routes to the matching branch', async () => {
    expect(finalOutput(await run(file, fakeHost().host, { n: 2 }))).toBe('BIG')
  })
  it('routes to the default otherwise', async () => {
    expect(finalOutput(await run(file, fakeHost().host, { n: 0 }))).toBe('SMALL')
  })
})

describe('engine: checkpoint node', () => {
  it('logs the message and the observed input, passing it through', async () => {
    const events = await run(
      chain(T(), node('x', 'transformer', { template: 'hello' }), node('d', 'checkpoint', { checkpointName: 'D', message: 'got {{ input }}' }), O()),
      fakeHost().host,
    )
    expect(notes(events, 'd')).toEqual(['[D] got hello\n\nobserved:\nhello'])
    expect(finalOutput(events)).toBe('hello')
  })
})

describe('engine: user-input node', () => {
  it('asks the host and uses the answer', async () => {
    const f = fakeHost()
    const events = await run(chain(T(), node('u', 'user-input', { prompt: 'Name?' }), O()), f.host)
    expect(f.inputs[0]).toMatchObject({ nodeId: 'u', prompt: 'Name?', inputType: 'text', required: true })
    expect(finalOutput(events)).toBe('typed')
  })
  it('no answer to a required input fails the node', async () => {
    const f = fakeHost({ requestInput: async () => null })
    const events = await run(chain(T(), node('u', 'user-input', { prompt: 'Name?' }), O()), f.host)
    expect(nodeError(events, 'u')).toBe('input required — cancelled')
  })
})

describe('engine: api node', () => {
  const apiFlow = (): object => chain(T(), node('api', 'api', { url: 'https://x.test/{{ q }}' }), O())
  it('fetches the templated URL through the host', async () => {
    const f = fakeHost()
    const events = await run(apiFlow(), f.host, { q: 'a' })
    expect(f.fetches).toEqual(['https://x.test/a'])
    expect(finalOutput(events)).toBe('pong')
  })
  it('a non-2xx status is a node error', async () => {
    const f = fakeHost({ fetch: async () => ({ status: 500, statusText: 'Server Error', text: 'boom' }) })
    expect(nodeError(await run(apiFlow(), f.host, { q: 'a' }), 'api')).toBe('HTTP 500 Server Error — boom')
  })
  it('a URL the host blocks is reported as blocked', async () => {
    const f = fakeHost({ fetch: async () => { throw new WorkflowBlockedError('refusing to call an internal/loopback host: "127.0.0.1"') } })
    expect(nodeError(await run(apiFlow(), f.host, { q: 'a' }), 'api')).toBe('blocked: refusing to call an internal/loopback host: "127.0.0.1"')
  })
  it('a network failure is reported as such', async () => {
    const f = fakeHost({ fetch: async () => { throw new Error('offline') } })
    expect(nodeError(await run(apiFlow(), f.host, { q: 'a' }), 'api')).toBe('request failed (CORS or network?): offline')
  })
})

describe('engine: loop node', () => {
  it('count: runs the body each pass and collects the outputs', async () => {
    const file = flow(
      [T(), node('l', 'loop', { loopType: 'count', count: 3, body: ['b'], onComplete: 'o' }),
        node('b', 'transformer', { template: '{{ loop_index }}' }), O()],
      [edge('t', 'l')],
    )
    const events = await run(file, fakeHost().host)
    expect(starts(events, 'b')).toBe(3)
    expect(JSON.parse(finalOutput(events) ?? '')).toEqual(['0', '1', '2'])
  })
})

describe('engine: parallel node', () => {
  it('fork: runs both branches and hands the join the merged result', async () => {
    const file = flow(
      [T(), node('p', 'parallel', { mode: 'fork', forkCount: 2, forkLabels: ['A', 'B'], waitFor: 'all', mergeStrategy: 'object' }),
        node('a1', 'transformer', { template: 'a' }), node('b1', 'transformer', { template: 'b' }),
        node('j', 'transformer', { template: '{{ input }}' }), O()],
      [edge('t', 'p'), edge('p', 'a1', { sourceHandle: 'fork-0' }), edge('p', 'b1', { sourceHandle: 'fork-1' }),
        edge('a1', 'j', { targetHandle: 'input-0' }), edge('b1', 'j', { targetHandle: 'input-1' }), edge('j', 'o')],
    )
    const events = await run(file, fakeHost().host)
    expect(JSON.parse(finalOutput(events) ?? '')).toEqual({ A: 'a', B: 'b' })
  })
})

describe('engine: unknown node types and abort', () => {
  it('an unknown type is skipped with a reason and the run continues', async () => {
    const events = await run(chain(T(), node('c', 'code'), node('x', 'transformer', { template: 'after' }), O()), fakeHost().host)
    expect(skipReason(events, 'c')).toBe('node type "code" is not supported in the browser runner yet.')
    expect(finalOutput(events)).toBe('after')
  })

  it('an aborted signal stops the walk with Aborted and calls no model', async () => {
    const f = fakeHost()
    const ac = new AbortController()
    ac.abort()
    const events = await run(chain(T(), node('p', 'prompt', { rawPrompt: 'x' }), O()), f.host, {}, { signal: ac.signal })
    expect(events.some((e) => e.type === 'error' && e.message === 'Aborted')).toBe(true)
    expect(f.modelCalls).toHaveLength(0)
  })
})

describe('engine: workflow-level guardrails', () => {
  it('an input scrub compiles the host redaction prompt with the rule policy and rewrites the parameter', async () => {
    const f = fakeHost({}, (m) => (m[0]?.role === 'system' && m[0].content.includes('redaction filter')
      ? { content: 'clean' }
      : { content: '{"pass":false,"reason":"pii"}' }))
    const file = {
      ...chain(T(), node('x', 'transformer', { template: '{{ topic }}' }), O()),
      guardrails: {
        input: [{ id: 'g1', label: 'PII', systemPrompt: 'Find names. Respond with ONLY JSON {"pass":bool}', passExpression: '{{ pass }}', action: 'scrub' }],
        output: [],
      },
    }
    const events = await run(file, f.host, { topic: 'secret' })
    expect(f.compiles).toContainEqual({ src: { text: 'You are a redaction filter for {{ policy }}' }, vars: { policy: 'Find names' } })
    expect(finalOutput(events)).toBe('clean')
  })
})
