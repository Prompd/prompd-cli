/* One trigger vocabulary (spec 2026-10-11 section 5.1), added without removing
 * anything: TriggerNodeData gains `triggers: Trigger[]` while the legacy
 * single-trigger fields keep round-tripping until the browser moves to
 * `triggers` (workflow deploy Plan 2). Owner ruling 2026-10-11. */
import {
  parseWorkflow, serializeWorkflow, createWorkflowNode, validateWorkflow,
  TRIGGER_TYPES, isTriggerType,
  type Trigger, type WorkflowFile,
} from '../src/index'

function flowWith(data: Record<string, unknown>): string {
  return JSON.stringify({
    version: '1.0',
    metadata: { id: 'f', name: 'f' },
    nodes: [
      { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Start', ...data } },
      { id: 'o', type: 'output', position: { x: 0, y: 100 }, data: { label: 'Output' } },
    ],
    edges: [{ id: 'e', source: 't', target: 'o' }],
  })
}

const LEGACY = {
  triggerType: 'event',
  eventName: 'events.workflow.run.onComplete', eventFilter: 'payload.ok',
  scheduleType: 'cron', scheduleCron: '0 9 * * *', scheduleTimezone: 'UTC', scheduleEnabled: true,
  fileWatchPaths: ['*.md'], fileWatchEvents: ['modify'],
  webhookMethods: ['POST'],
  description: 'kept', outputSchema: { type: 'object' },
}

const triggerData = (file: WorkflowFile): Record<string, unknown> =>
  file.nodes.find((n) => n.type === 'trigger')!.data as unknown as Record<string, unknown>

const triggerCodes = (json: string): string[] =>
  parseWorkflow(json).errors.map((e) => e.code).filter((c) => c.includes('TRIGGER') || c === 'MISSING_SCHEDULE' || c === 'MISSING_WEBHOOK_PATH')

const roundTrip = (json: string): WorkflowFile => {
  const parsed = parseWorkflow(json)
  return parseWorkflow(serializeWorkflow(parsed.file, parsed.nodes, parsed.edges)).file
}

describe('trigger vocabulary', () => {
  it('lists the ten trigger types crew uses', () => {
    expect([...TRIGGER_TYPES]).toEqual([
      'manual', 'file-change', 'run-complete', 'interval-while-open', 'app-init',
      'workspace-init', 'schedule', 'continuous', 'self-directed', 'external-webhook',
    ])
    expect(isTriggerType('schedule')).toBe(true)
    expect(isTriggerType('webhook')).toBe(false)
    expect(isTriggerType(3)).toBe(false)
  })
})

describe('legacy trigger fields (deprecated, kept until Plan 2)', () => {
  it('still load and round-trip through parseWorkflow and serializeWorkflow', () => {
    const d = triggerData(roundTrip(flowWith(LEGACY)))
    expect(d).toEqual({ label: 'Start', ...LEGACY })
  })

  it('a legacy event trigger raises no trigger validation error', () => {
    expect(triggerCodes(flowWith(LEGACY))).toEqual([])
  })

  it('legacy schedule and webhook checks still apply when triggerType names them', () => {
    expect(triggerCodes(flowWith({ triggerType: 'schedule' }))).toContain('MISSING_SCHEDULE')
    expect(triggerCodes(flowWith({ triggerType: 'webhook' }))).toContain('MISSING_WEBHOOK_PATH')
  })

  it('createWorkflowNode keeps the manual default, so the canvas behaves as today', () => {
    const n = createWorkflowNode('trigger', { x: 0, y: 0 }, 't')
    expect((n.data as unknown as Record<string, unknown>).triggerType).toBe('manual')
  })
})

describe('triggers list', () => {
  const triggers: Trigger[] = [
    { type: 'schedule', config: { cron: '0 9 * * 1' } },
    { type: 'file-change', config: { include: ['notes/**/*.md'], exclude: [] } },
    { type: 'run-complete', config: { after: 'morning-brief', onStatus: 'done' } },
  ]

  it('round-trips through parseWorkflow and serializeWorkflow', () => {
    expect(triggerData(roundTrip(flowWith({ triggers }))).triggers).toEqual(triggers)
  })

  it('a node with only triggers validates', () => {
    expect(triggerCodes(flowWith({ triggers }))).toEqual([])
  })

  it('a node with neither triggers nor triggerType validates (runs by hand)', () => {
    expect(triggerCodes(flowWith({}))).toEqual([])
    const file = JSON.parse(flowWith({})) as WorkflowFile
    expect(validateWorkflow(file).errors.map((e) => e.code)).not.toContain('MISSING_TRIGGER_TYPE')
  })

  it('both fields together validate (the browser writes triggerType until Plan 2)', () => {
    expect(triggerCodes(flowWith({ triggerType: 'manual', triggers }))).toEqual([])
  })

  it('rejects triggers that is not a list', () => {
    expect(triggerCodes(flowWith({ triggers: 'schedule' }))).toContain('INVALID_TRIGGERS')
  })

  it('rejects an unknown trigger type', () => {
    expect(triggerCodes(flowWith({ triggers: [{ type: 'webhook' }] }))).toContain('INVALID_TRIGGER_TYPE')
  })

  it('rejects a config that is not an object', () => {
    expect(triggerCodes(flowWith({ triggers: [{ type: 'manual', config: ['x'] }] }))).toContain('INVALID_TRIGGER_CONFIG')
  })

  it('rejects a schedule entry without a cron', () => {
    expect(triggerCodes(flowWith({ triggers: [{ type: 'schedule' }] }))).toContain('MISSING_SCHEDULE')
    expect(triggerCodes(flowWith({ triggers: [{ type: 'schedule', config: { cron: '  ' } }] }))).toContain('MISSING_SCHEDULE')
  })
})
