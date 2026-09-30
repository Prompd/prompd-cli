import { executeWorkflow } from '../src/lib/workflowExecutor';
import { parseWorkflow } from '../src/lib/workflowParser';

// A guardrail that cannot read its judge's verdict must REJECT, never pass.
// Each test below pins one path that used to fail open: an unreadable reply,
// a verdict missing the field the configured method needs, or a judge call
// that threw.

function flowJson(nodes: Array<Record<string, unknown>>, edges: Array<Record<string, unknown>> = []): string {
  return JSON.stringify({ version: '1.0', metadata: { id: 'f', name: 'f' }, nodes, edges });
}

const seedNode = { id: 'seed', type: 'prompt', position: { x: 0, y: 0 }, data: { label: 'Seed', rawPrompt: 'seed', sourceType: 'raw' } };

// ----------------------------------------------------------------------------
// Chat-agent embedded guardrail
// ----------------------------------------------------------------------------

function chatAgentFlow(guard: Record<string, unknown>) {
  return parseWorkflow(flowJson([
    seedNode,
    {
      id: 'agent1',
      type: 'chat-agent',
      position: { x: 0, y: 0 },
      data: {
        label: 'My Agent',
        agentSystemPrompt: 'sys',
        userInputEnabled: false,
        guardrailEnabled: true,
        guardrailSystemPrompt: 'judge it',
        ...guard,
        loopMode: 'single-turn',
        maxIterations: 1,
        minIterations: 0,
      },
    },
  ], [{ id: 'e1', source: 'seed', target: 'agent1' }]));
}

type Judge = string | (() => Promise<string>);

async function runChatAgent(guard: Record<string, unknown>, judge: Judge) {
  let agentRan = false;
  const agentInputs: string[] = [];
  const result = await executeWorkflow(chatAgentFlow(guard), {}, {
    executePrompt: async (p: string) => {
      if (p.startsWith('raw:') && p.includes('judge it')) return typeof judge === 'string' ? judge : judge();
      return 'seed output';
    },
    onPromptExecute: async (req) => {
      agentRan = true;
      for (const m of req.messages) if (m.role === 'user') agentInputs.push(m.content);
      return { success: true, response: 'agent reply' };
    },
  });
  const out = result.nodeOutputs.agent1 as { rejected?: boolean; guardrailResult?: { rejected: boolean; analysis?: string } };
  return { result, agentRan, agentInputs, out };
}

describe('chat-agent guardrail fails closed', () => {
  it('A1: a prose judge reply (no JSON) rejects and the agent never runs', async () => {
    const { result, agentRan, out } = await runChatAgent({}, 'Looks fine to me, go ahead.');
    expect(result.errors).toHaveLength(0);
    expect(agentRan).toBe(false);
    expect(out.rejected).toBe(true);
    expect(out.guardrailResult?.analysis).toMatch(/fail closed/);
  });

  it('A2: a JSON parse failure with no expression configured rejects', async () => {
    const { agentRan, out } = await runChatAgent({}, '{"rejected": false, oops}');
    expect(agentRan).toBe(false);
    expect(out.rejected).toBe(true);
    expect(out.guardrailResult?.analysis).toMatch(/fail closed/);
  });

  it('A2 control: a JSON parse failure with a rejectionExpression still lets the expression decide', async () => {
    const { agentRan } = await runChatAgent(
      { guardrailRejectionExpression: "{{ response.includes('oops') == false }}" },
      '{"rejected": false, oops}',
    );
    expect(agentRan).toBe(true);
  });

  it('A3: a judge call that throws rejects (does not run the agent unjudged)', async () => {
    const { result, agentRan, out } = await runChatAgent({}, async () => { throw new Error('Gateway 401'); });
    expect(result.errors).toHaveLength(0);
    expect(agentRan).toBe(false);
    expect(out.rejected).toBe(true);
    expect(out.guardrailResult?.analysis).toMatch(/Gateway 401/);
    expect(out.guardrailResult?.analysis).toMatch(/fail closed/);
  });

  it('A3: a judge-call failure flows through guardrailFailAction like any rejection', async () => {
    const { agentRan, agentInputs } = await runChatAgent(
      { guardrailFailAction: 'continue', guardrailCustomRejectMessage: 'BLOCKED' },
      async () => { throw new Error('network down'); },
    );
    expect(agentRan).toBe(true);
    expect(agentInputs).toContain('BLOCKED');
    expect(agentInputs).not.toContain('seed output');
  });

  it('A4: the fallback path rejects a verdict with no rejected/pass field', async () => {
    const { agentRan, out } = await runChatAgent({}, '```json\n{"analysis": "fine", "score": 0.9}\n```');
    expect(agentRan).toBe(false);
    expect(out.rejected).toBe(true);
    expect(out.guardrailResult?.analysis).toMatch(/fail closed/);
  });

  it('A4 control: the fallback path still honours an explicit rejected=false or pass=true', async () => {
    expect((await runChatAgent({}, '```json\n{"rejected": false}\n```')).agentRan).toBe(true);
    expect((await runChatAgent({}, '```json\n{"pass": true}\n```')).agentRan).toBe(true);
    expect((await runChatAgent({}, '```json\n{"pass": false}\n```')).agentRan).toBe(false);
  });

  it('A4 control: an unfenced JSON verdict without a "rejected" key is still read, not treated as prose', async () => {
    expect((await runChatAgent({}, '{"pass": true}')).agentRan).toBe(true);
    expect((await runChatAgent({ guardrailScoreThreshold: 0.5 }, ' {"score": 0.8} ')).agentRan).toBe(true);
  });

  it('A4: the field check rejects when the configured field is missing (passWhen=false)', async () => {
    const { agentRan, out } = await runChatAgent(
      { guardrailRejectionField: 'unsafe', guardrailExpectedFormat: 'json', guardrailPassWhen: 'false' },
      '```json\n{"analysis": "fine"}\n```',
    );
    expect(agentRan).toBe(false);
    expect(out.rejected).toBe(true);
  });

  it('A4: the field check default rejects a verdict with no rejected field', async () => {
    const { agentRan, out } = await runChatAgent(
      { guardrailRejectionField: 'safe', guardrailExpectedFormat: 'json' },
      '```json\n{"safe": true}\n```',
    );
    expect(agentRan).toBe(false);
    expect(out.rejected).toBe(true);
  });

  it('A4 control: the field check still passes a present field that says pass', async () => {
    const { agentRan } = await runChatAgent(
      { guardrailRejectionField: 'unsafe', guardrailExpectedFormat: 'json', guardrailPassWhen: 'false' },
      '```json\n{"unsafe": false}\n```',
    );
    expect(agentRan).toBe(true);
  });

  it('score threshold: a missing score rejects instead of falling through to rejected=false', async () => {
    const { agentRan, out } = await runChatAgent({ guardrailScoreThreshold: 0.5 }, '```json\n{"rejected": false}\n```');
    expect(agentRan).toBe(false);
    expect(out.rejected).toBe(true);
    expect(out.guardrailResult?.analysis).toMatch(/fail closed/);
  });

  it('score threshold control: a score at or above the threshold passes, below rejects', async () => {
    expect((await runChatAgent({ guardrailScoreThreshold: 0.5 }, '```json\n{"score": 0.5}\n```')).agentRan).toBe(true);
    expect((await runChatAgent({ guardrailScoreThreshold: 0.5 }, '```json\n{"score": 0.4, "rejected": false}\n```')).agentRan).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// Standalone guardrail node
// ----------------------------------------------------------------------------

async function runGuardNode(guard: Record<string, unknown>, judge: string) {
  const workflow = parseWorkflow(flowJson([
    seedNode,
    {
      id: 'guard1',
      type: 'guardrail',
      position: { x: 0, y: 0 },
      data: { label: 'My Guardrail', systemPrompt: 'Validate the input', ...guard },
    },
  ], [{ id: 'e1', source: 'seed', target: 'guard1' }]));
  const result = await executeWorkflow(workflow, {}, {
    executePrompt: async (p: string) => (p.includes('guardrail-validation') ? judge : 'seed output'),
  });
  const out = result.nodeOutputs.guard1 as { rejected: boolean };
  const failedClosed = result.trace.entries.some(e => e.nodeId === 'guard1' && /fail(ed)? closed/.test(e.message ?? ''));
  return { result, out, failedClosed };
}

describe('standalone guardrail node fails closed', () => {
  it('B: a prose reply rejects, with no keyword heuristic deciding', async () => {
    const { result, out, failedClosed } = await runGuardNode({}, 'This looks good to me.');
    expect(result.errors).toHaveLength(0);
    expect(out.rejected).toBe(true);
    expect(failedClosed).toBe(true);
  });

  it('B: a JSON verdict with neither pass nor rejected (no expression, no threshold) rejects', async () => {
    const { out, failedClosed } = await runGuardNode({}, '```json\n{"analysis": "fine", "score": 0.9}\n```');
    expect(out.rejected).toBe(true);
    expect(failedClosed).toBe(true);
  });

  it('B: a configured scoreThreshold with no score rejects even if rejected=false', async () => {
    const { out, failedClosed } = await runGuardNode({ scoreThreshold: 0.5 }, '{"rejected": false}');
    expect(out.rejected).toBe(true);
    expect(failedClosed).toBe(true);
  });

  it('B: a JSON reply that is not a verdict object rejects', async () => {
    const { out, failedClosed } = await runGuardNode({}, '"looks fine"');
    expect(out.rejected).toBe(true);
    expect(failedClosed).toBe(true);
  });

  it('B control: readable verdicts still decide as before', async () => {
    expect((await runGuardNode({}, '{"rejected": false}')).out.rejected).toBe(false);
    expect((await runGuardNode({}, '{"rejected": true}')).out.rejected).toBe(true);
    expect((await runGuardNode({}, '{"pass": true}')).out.rejected).toBe(false);
    expect((await runGuardNode({}, '{"pass": false}')).out.rejected).toBe(true);
    expect((await runGuardNode({ scoreThreshold: 0.5 }, '{"score": 0.7}')).out.rejected).toBe(false);
    expect((await runGuardNode({ scoreThreshold: 0.5 }, '{"score": 0.3}')).out.rejected).toBe(true);
    expect((await runGuardNode({ passExpression: '{{ score > 0.5 }}' }, '{"score": 0.7}')).out.rejected).toBe(false);
  });
});
