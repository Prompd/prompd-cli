/* Workflow run model: the event CONTRACT the workflow engine emits, the
 * structured VIEW-MODEL a Result panel renders (steps + telemetry), and the pure
 * REDUCERS folding events into that view. Zero dependencies. Moved from
 * prompd-web's packages/editor/workflowModel.ts (2026-10-11), which now
 * re-exports this module. */

/* ---- run event contract (emitted by a workflow runner) ---- */

/** Outcome of a workflow-level guardrail phase — lets the timeline render a
 * shield + action badge instead of a generic note step. */
export interface GuardrailStepInfo {
  action: 'deny' | 'scrub' | 'reroute' | 'warn' | 'pass';
  phase: 'input' | 'output';
  /** The guardrail's label/preset that fired (absent for a clean pass). */
  by?: string;
}

export type WfEvent =
  | { type: 'node-start'; id: string; nodeType: string; label: string }
  /** A node's output. `note: true` marks diagnostic lines (provider set, tool
   * calls, debug echoes) so the UI can fold them under the step instead of
   * treating them as the node's real output. `sub` names a sub-component of a
   * composite node (the agent's "input guardrail" / "output guardrail") — the
   * UI renders these in arrival order, quieter than the main output. `guardrail`
   * marks a workflow-level guardrail phase outcome. */
  | { type: 'node-output'; id: string; output: string; note?: boolean; sub?: string; guardrail?: GuardrailStepInfo }
  /** What the node was actually handed, emitted right after its node-start once
   * templating has resolved: the model + settings in effect, the final system and
   * user prompts, and the context variables the node read. Purely diagnostic — it
   * drives the step's inspect drawers and is STRIPPED before a run is persisted
   * (see stripRunInspect), so prompt text never reaches localStorage. */
  | ({ type: 'node-input'; id: string } & StepInput)
  /** Emitted once per node after it settles: wall-clock ms, plus token usage and
   * estimated cost for model-backed nodes (cost only when the model's pricing is
   * known in the catalog). */
  | { type: 'node-end'; id: string; ms: number; inTok?: number; outTok?: number; cost?: number }
  | { type: 'node-skip'; id: string; reason: string }
  | { type: 'node-error'; id: string; message: string; guardrail?: GuardrailStepInfo }
  /** A node failed inside a parallel branch. The branch stops but the run continues
   * (the parallel node decides the outcome), so unlike node-error this is not terminal. */
  | { type: 'node-failed'; id: string; message: string }
  /** Mechanical degrade applied to the remaining frontier (no LLM): models swapped
   * cheaper and/or optional nodes dropped. */
  | { type: 'degrade'; downgraded: { id: string; model: string }[]; dropped: string[]; reason: string }
  /** A live re-plan round-trip: the orchestrator was handed budget state to re-fit
   * the remaining work. */
  | { type: 'replan'; reason: string; spent: number; limit: number; kind: 'usd' | 'tokens' | 'ms' }
  | { type: 'done'; finalOutput: string; stopped?: 'budget' }
  | { type: 'error'; message: string };

/** Mid-run request for a `user-input` node — handed to opts.requestInput so the
 * host can render a typed prompt (text/textarea/choice/confirm/number). */
export interface WfInputRequest {
  nodeId: string;
  /** The question, already template-substituted. */
  prompt: string;
  inputType: 'text' | 'textarea' | 'choice' | 'confirm' | 'number';
  /** Allowed values when inputType is 'choice'. */
  options?: string[];
  placeholder?: string;
  required: boolean;
  defaultValue?: string;
  /** Upstream output to show for context, when the node's showContext is set. */
  context?: string;
  /** Aborts when this prompt is no longer wanted (e.g. its parallel branch lost);
   * the host should close the prompt and resolve null. */
  signal?: AbortSignal;
}

/* ---- view model (rendered by the Result panel) ---- */

export type StepStatus = 'running' | 'ok' | 'skip' | 'error';

/** One displayed piece of a step, in arrival order. `main` is the node's real
 * output; `sub` is a composite sub-component's report (the agent's guardrails)
 * rendered quieter; `note` is a diagnostic line (tool calls, debug echoes). */
export interface StepSegment { kind: 'main' | 'sub' | 'note'; label?: string; text: string }

/** One context variable a node read, with the value it resolved to. */
export interface StepVar { name: string; value: string }

/** Everything a node was handed — what the step's inspect drawers render. Every
 * field is optional: a transformer has no model, a mapper no system prompt. */
export interface StepInput {
  model?: string;
  settings?: Record<string, string | number | boolean>;
  system?: string;
  user?: string;
  vars?: StepVar[];
}

export interface WorkflowStep {
  id: string;
  label: string;
  nodeType: string;
  status: StepStatus;
  /** The node's real output (note/sub lines excluded), newline-joined. */
  output: string;
  /** Diagnostic lines (provider set, tool calls, debug echoes). */
  notes: string[];
  /** Everything the node reported, in order — what the step body renders.
   * (Optional only because runs persisted before it existed lack it.) */
  segments?: StepSegment[];
  /** Skip/error explanation. */
  reason?: string;
  /** Workflow-level guardrail outcome (drives the shield + action badge). */
  guardrail?: GuardrailStepInfo;
  /** What the node was handed (resolved prompts, model, settings, bound vars).
   * Live runs only — stripped before persistence, and absent on older runs. */
  input?: StepInput;
  ms?: number;
  inTok?: number;
  outTok?: number;
  cost?: number;
}

export interface WorkflowRun {
  steps: WorkflowStep[];
  status: 'running' | 'done' | 'error';
  finalOutput: string;
  totalMs: number | null;
  error?: string;
  /** Wall-clock start (ms epoch), used to compute totalMs on completion. */
  startedAt: number;
  /** Set when the run was hard-stopped before natural completion. */
  stopped?: 'budget';
}

export function emptyRun(startedAt: number): WorkflowRun {
  return { steps: [], status: 'running', finalOutput: '', totalMs: null, startedAt };
}

/* ---- reducers ---- */

/** Fold one event into the run, returning a new run (steps array + touched step
 * are fresh so referential-equality checks re-render). */
export function applyWfEvent(run: WorkflowRun, e: WfEvent, now: number): WorkflowRun {
  const steps = run.steps.slice();
  // Get a fresh, mutable copy of the step for `id` (creating it if the event
  // arrived without a preceding node-start, e.g. an unsupported-node skip).
  const touch = (id: string): WorkflowStep => {
    const i = steps.findIndex((s) => s.id === id);
    if (i < 0) {
      const s: WorkflowStep = { id, label: id, nodeType: '', status: 'running', output: '', notes: [], segments: [] };
      steps.push(s);
      return s;
    }
    const s = { ...steps[i] };
    steps[i] = s;
    return s;
  };

  switch (e.type) {
    case 'node-start': {
      const s = touch(e.id);
      s.label = e.label;
      s.nodeType = e.nodeType;
      s.status = 'running';
      break;
    }
    case 'node-output': {
      const s = touch(e.id);
      const seg: StepSegment = e.sub
        ? { kind: 'sub', label: e.sub, text: e.output }
        : e.note
          ? { kind: 'note', text: e.output }
          : { kind: 'main', text: e.output };
      s.segments = [...(s.segments ?? []), seg];
      if (e.note) s.notes = [...s.notes, e.output];
      else if (!e.sub) s.output = s.output ? `${s.output}\n${e.output}` : e.output;
      if (e.guardrail) s.guardrail = e.guardrail;
      break;
    }
    case 'node-skip': {
      const s = touch(e.id);
      s.status = 'skip';
      s.reason = e.reason;
      break;
    }
    case 'node-failed': {
      const s = touch(e.id);
      s.status = 'error';
      s.reason = e.message;
      break;
    }
    case 'node-error': {
      // Terminal in the runner (it stops after a node error), so end the run too —
      // no `done` will follow, and the panel must leave the "running" state.
      const s = touch(e.id);
      s.status = 'error';
      s.reason = e.message;
      if (e.guardrail) s.guardrail = e.guardrail;
      return { ...run, steps, status: 'error', error: e.message, totalMs: run.totalMs ?? Math.round(now - run.startedAt) };
    }
    case 'node-input': {
      const s = touch(e.id);
      // Rebuilt rather than spread from the event so `type`/`id` stay out of the
      // payload and absent fields stay absent (a loop re-entry replaces wholesale).
      const input: StepInput = {};
      if (e.model !== undefined) input.model = e.model;
      if (e.settings !== undefined) input.settings = e.settings;
      if (e.system !== undefined) input.system = e.system;
      if (e.user !== undefined) input.user = e.user;
      if (e.vars !== undefined) input.vars = e.vars;
      s.input = input;
      break;
    }
    case 'node-end': {
      const s = touch(e.id);
      s.ms = e.ms;
      s.inTok = e.inTok;
      s.outTok = e.outTok;
      s.cost = e.cost;
      if (s.status === 'running') s.status = 'ok';
      break;
    }
    case 'degrade': {
      const id = `adapt-${steps.length}`;
      const parts = [e.reason];
      if (e.downgraded.length) parts.push(`downgraded ${e.downgraded.map((d) => `${d.id} -> ${d.model}`).join(', ')}`);
      if (e.dropped.length) parts.push(`dropped ${e.dropped.join(', ')}`);
      steps.push({ id, label: 'Degraded', nodeType: 'degrade', status: 'ok', output: parts.join('; '), notes: [], segments: [{ kind: 'note', text: parts.join('; ') }] });
      return { ...run, steps };
    }
    case 'replan': {
      const id = `adapt-${steps.length}`;
      const text = `${e.reason} (${e.kind} ${e.spent} > ${e.limit})`;
      steps.push({ id, label: 'Re-planned', nodeType: 'replan', status: 'ok', output: text, notes: [], segments: [{ kind: 'note', text }] });
      return { ...run, steps };
    }
    case 'done':
      return { ...run, steps, status: run.status === 'error' ? 'error' : 'done', finalOutput: e.finalOutput, totalMs: Math.round(now - run.startedAt), stopped: e.stopped };
    case 'error':
      return { ...run, steps, status: 'error', error: e.message, totalMs: Math.round(now - run.startedAt) };
  }
  return { ...run, steps };
}

/* ---- persistence hygiene ---- */

/** A copy of `run` with every step's inspect payload removed. Resolved prompts and
 * bound context are useful while a run is on screen but must not be written to
 * localStorage (size, and prompt content at rest), so every surface that snapshots
 * a run passes it through this first. Returns the run unchanged when no step
 * carries inspect data, so old runs round-trip identically. */
export function stripRunInspect(run: WorkflowRun): WorkflowRun {
  if (!run.steps.some((s) => s.input !== undefined)) return run;
  return {
    ...run,
    steps: run.steps.map((s) => {
      if (s.input === undefined) return s;
      const { input: _input, ...rest } = s;
      return rest;
    }),
  };
}

/** The whole run as plain text — every step's status, its segments (notes,
 * sub-component reports, output) and reason, then the final output. This is what
 * the Result panel's copy button yields, so a denied/empty-final-output run still
 * copies the full log rather than nothing. */
export function runToText(run: WorkflowRun): string {
  const out: string[] = [];
  for (const s of run.steps) {
    const status = s.guardrail ? s.guardrail.action : s.status;
    out.push(`### ${s.label}${s.nodeType ? ` (${s.nodeType})` : ''} — ${status}`);
    const segments = s.segments ?? [
      ...s.notes.map((n): StepSegment => ({ kind: 'note', text: n })),
      ...(s.output.trim() ? [{ kind: 'main', text: s.output } as StepSegment] : []),
    ];
    for (const seg of segments) {
      if (seg.kind === 'sub') out.push(`${seg.label}:`, seg.text);
      else if (seg.kind === 'note') out.push(`· ${seg.text}`);
      else out.push(seg.text);
    }
    if (s.reason) out.push(s.reason);
    out.push('');
  }
  if (run.error) out.push(`Run error: ${run.error}`, '');
  if (run.finalOutput.trim()) out.push('--- Final output ---', run.finalOutput);
  return out.join('\n').trim();
}

export interface RunTotals { count: number; ok: number; skip: number; error: number; inTok: number; outTok: number; cost?: number }

export function runTotals(run: WorkflowRun): RunTotals {
  let ok = 0, skip = 0, error = 0, inTok = 0, outTok = 0, cost = 0, hasCost = false;
  for (const s of run.steps) {
    if (s.status === 'ok') ok++;
    else if (s.status === 'skip') skip++;
    else if (s.status === 'error') error++;
    if (s.inTok) inTok += s.inTok;
    if (s.outTok) outTok += s.outTok;
    if (s.cost != null) { cost += s.cost; hasCost = true; }
  }
  return { count: run.steps.length, ok, skip, error, inTok, outTok, cost: hasCost ? cost : undefined };
}
