/* The .pdflow workflow engine: an EDGE-AWARE WALK over a parsed workflow, the
 * same engine in the browser and on the sidecar. Moved from prompd-web's
 * src/workflows/run.ts (2026-10-11). Every platform call goes through the
 * WorkflowHost the caller passes in, so this file imports no platform code.
 *
 * From the trigger, follow each node's single out-edge; at a condition, evaluate
 * its branch expressions and follow the matching target (topological order can't
 * branch). Each node threads its output to the next. Supported: prompt (inline,
 * or a workspace .prmd/.md the host compiles), agent (input guardrail ->
 * tool-using agent loop -> output guardrail), guardrail, transformer (template
 * mode), condition, tool (off-chain grant), checkpoint/callback, user-input,
 * loop, api, output, and parallel (fork mode, scheduled by runBranches). Other
 * node types are skipped with a note.
 */
import type { ParsedWorkflow } from '../workflowParser'
import type { WorkflowNode } from '../workflowTypes'
import { runBranches, mergeBranchResults, traceForkBranches, forkJoinId } from '../parallel'
import { isExpressionError, describeExpressionFailure } from '../expression'
import type { WfEvent, WfInputRequest, StepVar } from './model'
import {
  isWorkflowBlockedError, isWorkflowNoWorkspaceError,
  type WorkflowHost, type WfMessage, type WfUsage, type WfRetryInfo,
} from './host'
import { parseVerdict, checkGuardrail, firstGuardrailHit, type WorkflowGuardrail, type WorkflowGuardrails } from './guardrails'
import { evalWorkflowCondition } from './expressions'
import { nodeToolNames } from './nodeTools'
import { resolveFlowFileRef } from './paths'
import { substitute, renderConversation } from './text'

export interface RunWorkflowOptions {
  signal?: AbortSignal
  onEvent?(e: WfEvent): void
  /** The .pdflow's workspace path; file references resolve against its folder. */
  flowPath?: string | null
}

function dataOf(n: WorkflowNode): Record<string, unknown> {
  return (n.data || {}) as unknown as Record<string, unknown>;
}
function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function nodeLabel(n: WorkflowNode): string {
  const d = dataOf(n);
  return asString(d.label) || asString(d.name) || n.type;
}
function safeJson(v: unknown): string {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

/* ---- run inspection (the diagnostic `node-input` event) ---- */

/** Cap on any single inspected value. Inspect payloads exist to be read in a
 * drawer, and a node can bind a whole document; anything longer is clipped with a
 * visible marker so the drawer never becomes the bottleneck. */
const INSPECT_MAX = 4000;
function clipInspect(v: string): string {
  if (v.length <= INSPECT_MAX) return v;
  return `${v.slice(0, INSPECT_MAX)}
… truncated (${v.length.toLocaleString('en-US')} chars total)`;
}
/** The {{ token }}s a set of templates reads, paired with the values they resolved
 * to in `ctx`. First-seen order, deduped, and keys absent from the scope are
 * dropped — so this reports what the node ACTUALLY bound, not the whole context. */
function varsUsed(templates: readonly string[], ctx: Record<string, unknown>): StepVar[] {
  const seen = new Set<string>();
  const out: StepVar[] = [];
  for (const t of templates) {
    if (!t) continue;
    for (const m of t.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
      const name = m[1];
      if (seen.has(name) || !(name in ctx)) continue;
      seen.add(name);
      const v = ctx[name];
      out.push({ name, value: clipInspect(v == null ? '' : typeof v === 'string' ? v : safeJson(v)) });
    }
  }
  return out;
}
/** Build a `node-input` event, dropping empty fields so the drawer only shows
 * what a given node type actually has (a transformer has no model or system). */
function inspectEvent(id: string, i: {
  model?: string;
  settings?: Record<string, string | number | boolean>;
  system?: string;
  user?: string;
  vars?: StepVar[];
}): WfEvent {
  const e: Extract<WfEvent, { type: 'node-input' }> = { type: 'node-input', id };
  if (i.model) e.model = i.model;
  if (i.settings && Object.keys(i.settings).length) e.settings = i.settings;
  if (i.system && i.system.trim()) e.system = clipInspect(i.system);
  if (i.user && i.user.trim()) e.user = clipInspect(i.user);
  if (i.vars && i.vars.length) e.vars = i.vars;
  return e;
}
/** Synthetic node ids for the workflow-level guardrail phases (so they surface as
 * steps in the run timeline alongside real nodes). */
const GR_IN = 'guardrails:input';
const GR_OUT = 'guardrails:output';

/** Node types that own a sub-graph; v1 forbids them inside a parallel branch. */
const CONTAINER_TYPES = new Set(['condition', 'loop', 'parallel']);
const WAIT_MODES = ['all', 'any', 'race', 'quorum'] as const;
const MERGE_STRATEGIES = ['object', 'array', 'first'] as const;

/** What a runner frame starts from: the root run, or one parallel branch. */
interface FrameInit {
  ctx: Record<string, unknown>;
  lastOutput: string;
  signal?: AbortSignal;
  currentModel: string;
  rerouteModel: string;
  /** Branch frame: node-error is re-emitted as node-failed (not terminal), and
   * events stop once `signal` aborts (a cancelled branch goes silent). */
  contained: boolean;
}

/** One execution frame: its own scope, output, timing and abort signal. */
interface Frame {
  ctx: Record<string, unknown>;
  executeNode: (node: WorkflowNode) => Promise<'stop' | 'continue'>;
  nextNode: (node: WorkflowNode) => WorkflowNode | undefined;
  output: () => string;
  /** The node currently executing (for marking an in-flight node cancelled). */
  currentId: () => string | null;
  /** The message of the last node-error this frame emitted. */
  lastError: () => string;
  outputGuarded: () => boolean;
  enforceInputGuardrails: (
    stepId: string, label: string, text: string,
    rewrite: (scrubOne: (s: string) => Promise<string>) => Promise<void>,
  ) => Promise<'continue' | 'deny'>;
  enforceOutputGuardrails: (text: string) => Promise<{ stop: boolean; text: string }>;
  flush: () => void;
}

export async function runWorkflow(
  parsed: ParsedWorkflow,
  paramValues: Record<string, unknown>,
  host: WorkflowHost,
  opts: RunWorkflowOptions = {},
): Promise<void> {
  const rawEmit = (e: WfEvent): void => { opts.onEvent?.(e); };
  const signal = opts.signal;

  // The workflow's effective default model comes from the host (the browser's
  // `workflows` surface model; the daemon's default on the sidecar). A provider
  // node's model goes through the host too, so a model that is no longer offered
  // falls back instead of reaching the gateway.
  const wfDefault = host.resolveModel(undefined, undefined);
  const providerModel: Record<string, string> = {};
  for (const n of parsed.file.nodes) {
    if (n.type === 'provider') providerModel[n.id] = host.resolveModel(asString(dataOf(n).model) || undefined, undefined);
  }

  // Graph for the edge-aware walk: at a condition we follow the matching
  // true/false target; at every other node the single out-edge. (Core's
  // getExecutionOrder is a plain topo sort — it can't branch, it would run BOTH
  // arms — so the runner does its own routing off the condition's data.)
  const byId = new Map(parsed.file.nodes.map((n) => [n.id, n]));
  const outBySource = new Map<string, ParsedWorkflow['file']['edges']>();
  for (const e of parsed.file.edges || []) {
    const list = outBySource.get(e.source) || [];
    list.push(e);
    outBySource.set(e.source, list);
  }

  // One user-input prompt at a time: the host shows a single input modal, and
  // parallel branches may each reach a user-input node. Tail of the queue.
  let inputQueue: Promise<void> = Promise.resolve();

  // Per-execution state lives in a FRAME: the root run is one frame, and each
  // parallel branch runs in its own (a copy of the scope, its own abort signal and
  // node timing), so concurrent branches never clobber each other.
  const createFrame = (init: FrameInit): Frame => {
    const ctx = init.ctx;
    const signal = init.signal;
    const currentModel = init.currentModel;
    let lastOutput = init.lastOutput;
    // Set by a `reroute` guardrail — forces every subsequent model call to the
    // rerouted model, overriding per-node provider/model resolution.
    let rerouteModel = init.rerouteModel;
    let currentId: string | null = null;
    let lastErrorMsg = '';
    // Set once the output node gated + emitted the final output, so the after-loop
    // fallback doesn't double-run the output guardrails.
    let outputGuarded = false;
    // The target a condition routed to this run (set when it executes, read to advance).
    const condRoute = new Map<string, string | undefined>();

    // Ask the host for input, queued behind any prompt already open. A frame that
    // is aborted while waiting (a branch that lost) is never prompted, and an
    // abort mid-prompt resolves null so the queue can't stall on a stale modal.
    const askInput = async (req: WfInputRequest): Promise<string | null> => {
      const prev = inputQueue;
      let release: () => void = () => undefined;
      inputQueue = new Promise<void>((r) => { release = r; });
      await prev;
      try {
        if (signal?.aborted) return null;
        return await new Promise<string | null>((resolve, reject) => {
          const onAbort = (): void => resolve(null);
          signal?.addEventListener('abort', onAbort, { once: true });
          host.requestInput({ ...req, signal }).then(resolve, reject).finally(() => signal?.removeEventListener('abort', onAbort));
        });
      } finally {
        // Release on the next macrotask, not the next microtask: when this answer
        // decides a race, the losing branches are aborted within the same microtask
        // chain, so a queued loser sees its abort instead of flashing a prompt.
        setTimeout(release, 0);
      }
    };
    // The tool set for a node's agent turn: the node's own data.tools unioned with any
    // attached Tools node's allowlist, else the read-only default (null). Shared with the
    // strategy runner via nodeToolNames.
    const toolsFor = (nodeId: string): string[] | null => nodeToolNames(parsed.file, nodeId);

    // Per-node telemetry. The runner emits node-start..outputs..(skip|error) per node
    // but has many exit points, so rather than instrument each, an emit WRAPPER stamps
    // the elapsed time and accumulated token usage as a single `node-end`, flushed when
    // the next node starts or the run ends. Cost is priced by the host (host.priceOf).
    let curUsage = { inTok: 0, outTok: 0, model: '' };
    const addUsage = (model: string, u: WfUsage | undefined): void => {
      curUsage.model = model;
      if (u) { curUsage.inTok += u.inputTokens || 0; curUsage.outTok += u.outputTokens || 0; }
    };
    const nowMs = (): number => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    // Estimated cost from the host's pricing; null (an unknown model) means no cost
    // rather than another model's price.
    const costOf = (u: { inTok: number; outTok: number; model: string }): number | undefined => {
      if (!u.model || (!u.inTok && !u.outTok)) return undefined;
      const p = host.priceOf(u.model);
      if (!p) return undefined;
      return (u.inTok / 1e6) * p.input + (u.outTok / 1e6) * p.output;
    };
    let timing: { id: string; t0: number } | null = null;
    const flushNodeEnd = (): void => {
      if (!timing) return;
      rawEmit({ type: 'node-end', id: timing.id, ms: Math.round(nowMs() - timing.t0), inTok: curUsage.inTok || undefined, outTok: curUsage.outTok || undefined, cost: costOf(curUsage) });
      timing = null;
    };
    const emit = (e: WfEvent): void => {
      if (init.contained && signal?.aborted) return; // a cancelled branch goes silent
      // node-error is terminal (the runner returns after it), so flush the failed
      // node's timing before it — otherwise its node-end would never be emitted.
      if (e.type === 'node-start') { flushNodeEnd(); curUsage = { inTok: 0, outTok: 0, model: '' }; timing = { id: e.id, t0: nowMs() }; currentId = e.id; }
      else if (e.type === 'done' || e.type === 'error' || e.type === 'node-error') { flushNodeEnd(); }
      if (e.type === 'node-error') {
        lastErrorMsg = e.message;
        // Inside a parallel branch a failure is contained: the branch stops, the run does not.
        if (init.contained) { rawEmit({ type: 'node-failed', id: e.id, message: e.message }); return; }
      }
      rawEmit(e);
    };

    // Resolve a node's model: provider-node ref > inline model > canvas current.
    // Used for the main chain AND for guardrail/evaluator judges.
    const modelFor = (d: Record<string, unknown>): string =>
      (typeof d.providerNodeId === 'string' && providerModel[d.providerNodeId]) ||
      asString(d.model) || currentModel || wfDefault;
    // The MAIN chain LLM nodes (prompt body, agent turn) additionally honor a
    // guardrail `reroute`. Guardrail/evaluator judges deliberately use plain
    // modelFor so a reroute can't silently redirect their own configured model.
    const chainModel = (d: Record<string, unknown>): string => rerouteModel || modelFor(d);
    // Retry/backoff lives behind host.callModel; the host reports each retry
    // before sleeping. The engine turns that into today's in-run note (agent and
    // prompt turns only, the ones run.ts passed a nodeId for) and a heal record
    // for the host's telemetry.
    const retryReporter = (model: string, nodeId?: string) => (info: WfRetryInfo): void => {
      if (nodeId) emit({ type: 'node-output', id: nodeId, output: `transient error — retrying (${info.attempt}/${info.maxRetries})`, note: true });
      host.onHeal?.({
        site: 'stream', kind: 'transient', strategy: 'retry-backoff', attempt: info.attempt, outcome: 'retrying',
        error: info.reason, model, ...(nodeId ? { nodeId } : {}),
      });
    };
    // One model call (guardrail judges, scrub): no node note, as before.
    const complete = async (model: string, messages: WfMessage[]): Promise<string> => {
      const turn = await host.callModel({ model, messages, signal, onRetry: retryReporter(model) });
      addUsage(model, turn.usage);
      return turn.content;
    };

    // Compile a workspace .prmd/.md file (the host resolves inherits:/{% include %}
    // against siblings) into its final prompt text. A host with no workspace throws
    // WorkflowNoWorkspaceError, which the prompt node turns into a skip.
    const compileFile = async (rawPath: string, vars: Record<string, unknown>): Promise<string> =>
      host.compilePrompt({ path: resolveFlowFileRef(opts.flowPath, rawPath) }, vars);

    /** A prompt/criteria field that can be inline text OR a workspace file. The UI
     * stores the file path under `<inlineKey>File` and the chosen mode under
     * `<inlineKey>Source` ('inline' | 'file'); mode is inferred as 'file' when only
     * a path is present. A file is compiled (inherits/includes resolved); a missing
     * workspace falls back to inline so a run never hard-fails on a stale ref.
     * Inline text gets the same {{ }} substitution as a prompt node's rawPrompt -
     * it used to be returned raw, so `{{ facts }}` in a guardrail or agent system
     * prompt reached the model as literal braces and the check ran blind. */
    const resolvePromptField = async (
      obj: Record<string, unknown>, inlineKey: string, vars: Record<string, unknown>,
    ): Promise<string> => {
      const inline = () => substitute(asString(obj[inlineKey]), vars);
      const filePath = asString(obj[`${inlineKey}File`]);
      const mode = asString(obj[`${inlineKey}Source`]) || (filePath ? 'file' : 'inline');
      if (mode === 'file' && filePath) {
        try { return await compileFile(filePath, vars); } catch { return inline(); }
      }
      return inline();
    };

    /** One agent run: a bounded tool-use loop (model turn -> run its tool calls
     * through the host -> feed results back -> repeat) up to maxIter. The host
     * owns lookup, policy, approval and failure steering, so a denial or failure
     * comes back as text the model sees. A call for a tool this node was not
     * given is answered `Unknown tool` and never reaches the host. Returns per
     * `outputMode`: the final assistant text ('final-response', default), the
     * whole transcript ('full-conversation'), or the most recent tool result
     * ('last-tool-result'). */
    const agentTurn = async (
      model: string, messages: WfMessage[], maxIter: number, nodeId: string, outputMode = 'final-response',
      toolNames: string[] | null = null,
    ): Promise<string> => {
      // null = the host's READ-ONLY default set; an explicit list (a Tool node's
      // grant or a per-node override) ADDS to it.
      const toolDefs = host.toolsFor(toolNames);
      const known = new Set(toolDefs.map((t) => t.name));
      let lastToolResult = '';
      for (let i = 0; i < maxIter; i++) {
        if (signal?.aborted) break;
        const turn = await host.callModel({ model, messages, tools: toolDefs, signal, onRetry: retryReporter(model, nodeId) });
        addUsage(model, turn.usage);
        const calls = turn.toolCalls;
        if (!calls.length) {
          const final = turn.content;
          if (outputMode === 'last-tool-result') return lastToolResult || final;
          if (outputMode === 'full-conversation') { messages.push({ role: 'assistant', content: final }); return renderConversation(messages); }
          return final;
        }
        messages.push({ role: 'assistant', content: turn.content, toolCalls: calls });
        for (const call of calls) {
          const result = known.has(call.name)
            ? (await host.runTool(call, { nodeId, signal })).content
            : `Unknown tool: ${call.name}`;
          lastToolResult = result;
          emit({ type: 'node-output', id: nodeId, output: `↳ ${call.name}`, note: true });
          messages.push({ role: 'tool', content: result, toolCallId: call.id });
        }
      }
      // maxIter exhausted without a final answer.
      if (outputMode === 'last-tool-result') return lastToolResult;
      if (outputMode === 'full-conversation') return renderConversation(messages);
      return '';
    };

    // Workflow-level guardrails (file.guardrails): an input list run on start over
    // the run parameters, an output list run over the final output. Strict
    // first-hit-wins per phase; actions: deny (stop), scrub (rewrite + continue),
    // reroute (swap model + continue), warn (flag + continue).
    const wfGuards = (parsed.file as { guardrails?: WorkflowGuardrails }).guardrails;
    // Display: the guardrail rule name, then its detail(s) as bullets underneath.
    const grBody = (name: string, reason: string, extra?: string): string =>
      [`${name}:`, extra && `  - ${extra}`, reason && `  - ${reason}`].filter(Boolean).join('\n');
    const judgeModelId = (): string => Object.values(providerModel)[0] || currentModel || wfDefault;
    const judge = async (rule: WorkflowGuardrail, text: string): Promise<Record<string, unknown>> =>
      parseVerdict(await complete(judgeModelId(), [
        ...(rule.systemPrompt ? [{ role: 'system' as const, content: rule.systemPrompt }] : []),
        { role: 'user' as const, content: text || '(empty)' },
      ]));
    const scrubText = async (rule: WorkflowGuardrail, text: string): Promise<string> => {
      const model = rule.target?.model || judgeModelId();
      // Describe WHAT to redact from the rule's policy, but strip the judge's
      // "respond with ONLY JSON {pass,reason}" instruction — otherwise the scrub
      // model returns a verdict instead of the cleaned text, corrupting the input.
      const policy = (rule.systemPrompt || '').replace(/\.?\s*Respond with ONLY JSON[\s\S]*$/i, '').trim() || 'sensitive or disallowed content';
      // A rule's own scrubPrompt still wins; the config default is what it falls
      // back to, so overriding it retunes every rule that has not set one.
      // As before, a template that fails to compile or compiles to nothing is used
      // raw rather than ending the run or sending an empty system prompt.
      let sys = rule.scrubPrompt;
      if (!sys) {
        const tpl = await host.redactionPrompt();
        try {
          sys = (await host.compilePrompt({ text: tpl }, { policy })).trim() || tpl.trim();
        } catch {
          sys = tpl.trim();
        }
      }
      return (await complete(model, [{ role: 'system', content: sys }, { role: 'user', content: text }])).trim();
    };

    // Run the input guardrails over one piece of user input (the run parameters at
    // start, or a user-input node's value mid-run — guardrails check ALL user
    // input). Strict first-hit-wins. `rewrite` applies a scrub back to the source.
    // Returns 'deny' when the run must stop.
    const enforceInputGuardrails = async (
      stepId: string, label: string, text: string,
      rewrite: (scrubOne: (s: string) => Promise<string>) => Promise<void>,
    ): Promise<'continue' | 'deny'> => {
      if (!wfGuards?.input?.length) return 'continue';
      emit({ type: 'node-start', id: stepId, nodeType: 'guardrail', label });
      const hit = await firstGuardrailHit(wfGuards.input, text, judge);
      if (!hit) { emit({ type: 'node-output', id: stepId, output: 'No violations', note: true, guardrail: { action: 'pass', phase: 'input' } }); return 'continue'; }
      const name = hit.rule.label || hit.rule.preset || 'guardrail';
      const reason = asString(hit.verdict.reason);
      if (hit.rule.action === 'deny') { emit({ type: 'node-error', id: stepId, message: grBody(name, reason || 'denied'), guardrail: { action: 'deny', phase: 'input', by: name } }); return 'deny'; }
      if (hit.rule.action === 'reroute') {
        rerouteModel = hit.rule.target?.model || '';
        emit({ type: 'node-output', id: stepId, output: grBody(name, reason, `rerouted to ${rerouteModel || '(unset)'}`), note: true, guardrail: { action: 'reroute', phase: 'input', by: name } });
      } else if (hit.rule.action === 'scrub') {
        await rewrite((s) => scrubText(hit.rule, s));
        emit({ type: 'node-output', id: stepId, output: grBody(name, reason), note: true, guardrail: { action: 'scrub', phase: 'input', by: name } });
      } else {
        emit({ type: 'node-output', id: stepId, output: grBody(name, reason), note: true, guardrail: { action: 'warn', phase: 'input', by: name } });
      }
      return 'continue';
    };

    // Run the output guardrails over `text`. Returns {stop} on deny (the output
    // must NOT be emitted) and the (possibly scrubbed) text otherwise.
    const enforceOutputGuardrails = async (text: string): Promise<{ stop: boolean; text: string }> => {
      if (!wfGuards?.output?.length) return { stop: false, text };
      emit({ type: 'node-start', id: GR_OUT, nodeType: 'guardrail', label: 'Output guardrails' });
      const hit = await firstGuardrailHit(wfGuards.output, text, judge);
      if (!hit) { emit({ type: 'node-output', id: GR_OUT, output: 'No violations', note: true, guardrail: { action: 'pass', phase: 'output' } }); return { stop: false, text }; }
      const name = hit.rule.label || hit.rule.preset || 'guardrail';
      const reason = asString(hit.verdict.reason);
      if (hit.rule.action === 'deny') { emit({ type: 'node-error', id: GR_OUT, message: grBody(name, reason || 'blocked'), guardrail: { action: 'deny', phase: 'output', by: name } }); return { stop: true, text }; }
      if (hit.rule.action === 'scrub') {
        const cleaned = await scrubText(hit.rule, text);
        emit({ type: 'node-output', id: GR_OUT, output: grBody(name, reason), note: true, guardrail: { action: 'scrub', phase: 'output', by: name } });
        return { stop: false, text: cleaned };
      }
      // reroute is meaningless once the output exists — surface as a warning.
      emit({ type: 'node-output', id: GR_OUT, output: grBody(name, hit.rule.action === 'reroute' ? 'reroute ignored on output' : reason), note: true, guardrail: { action: 'warn', phase: 'output', by: name } });
      return { stop: false, text };
    };

    // Execute one node: emit its events, mutate lastOutput/ctx. Returns 'stop' when
    // the run must end (a terminal error/deny already emitted), else 'continue'.
    const executeNode = async (node: WorkflowNode): Promise<'stop' | 'continue'> => {
      const label = nodeLabel(node);
      const d = dataOf(node);

      // Provider is off-chain (referenced via providerNodeId), so it isn't walked;
      // its model is already resolved into providerModel before the walk.
      if (node.type === 'provider') return 'continue';
      if (node.type === 'trigger') {
        emit({ type: 'node-start', id: node.id, nodeType: node.type, label });
        emit({ type: 'node-output', id: node.id, output: 'start', note: true });
        return 'continue';
      }
      // Condition: evaluate each branch expression over the run context; the first
      // truthy one routes to its target, else `default`. Routing is recorded for
      // nextNode; lastOutput passes through unchanged.
      if (node.type === 'condition') {
        emit({ type: 'node-start', id: node.id, nodeType: node.type, label });
        const scope = { ...ctx, input: lastOutput, previous_output: lastOutput, nodes: ctx };
        const conds = Array.isArray(d.conditions) ? (d.conditions as Array<{ expression?: string; target?: string }>) : [];
        let target: string | undefined;
        let taken = 'false';
        try {
          for (const c of conds) {
            if (evalWorkflowCondition(asString(c.expression), scope)) { target = asString(c.target) || undefined; taken = 'true'; break; }
          }
        } catch (e) {
          if (isExpressionError(e)) { emit({ type: 'node-error', id: node.id, message: describeExpressionFailure('Condition', label, e) }); return 'stop'; }
          throw e;
        }
        if (taken === 'false') target = asString(d.default) || undefined;
        condRoute.set(node.id, target);
        emit({ type: 'node-output', id: node.id, output: `→ ${taken} branch`, note: true });
        return 'continue';
      }
      // Tools nodes are off-chain (attached to a host), so they're never walked.
      if (node.type === 'prompt') {
        emit({ type: 'node-start', id: node.id, nodeType: node.type, label });
        ctx.input = lastOutput;
        ctx.previous_output = lastOutput;
        const params = (d.parameters as Record<string, string>) || {};
        for (const [k, expr] of Object.entries(params)) ctx[k] = substitute(asString(expr), ctx);

        // Source: inline raw text, or a workspace .prmd/.md file (compiled here,
        // resolving inherits/includes against siblings). Package refs still need
        // the backend; a file source without a workspace is skipped with a note.
        const rawText = asString(d.rawPrompt) || (d.sourceType === 'raw' ? asString(d.source) : '');
        const filePath = d.sourceType !== 'raw' ? asString(d.source) : '';
        let prompt: string;
        if (rawText) {
          prompt = substitute(rawText, ctx);
        } else if (filePath) {
          if (/^[\w.-]+\/[\w.-]+@/.test(filePath) || filePath.includes(':')) {
            emit({ type: 'node-skip', id: node.id, reason: `package prompt "${filePath}" needs the backend engine.` });
            return 'continue';
          }
          try {
            prompt = await compileFile(filePath, ctx);
          } catch (e) {
            if (isWorkflowNoWorkspaceError(e)) {
              emit({ type: 'node-skip', id: node.id, reason: `file prompt "${filePath}" needs a workspace — open the .pdflow from a folder to run it.` });
              return 'continue';
            }
            emit({ type: 'node-error', id: node.id, message: `couldn't compile "${filePath}": ${String((e as Error)?.message || e)}` });
            return 'stop';
          }
          if (!prompt.trim()) {
            emit({ type: 'node-skip', id: node.id, reason: `"${filePath}" compiled to empty output.` });
            return 'continue';
          }
        } else {
          emit({ type: 'node-skip', id: node.id, reason: 'no prompt source set.' });
          return 'continue';
        }

        const model = chainModel(d);
        const promptTools = toolsFor(node.id);
        emit(inspectEvent(node.id, {
          model,
          settings: { maxIterations: 6, ...(promptTools ? { tools: promptTools.join(', ') } : {}) },
          user: prompt,
          // The template's tokens when the prompt is inline; a compiled file's
          // tokens aren't recoverable post-compile, so fall back to what the node
          // declared plus the upstream value it was handed.
          vars: varsUsed(rawText ? [rawText] : [...Object.values(params), '{{ input }}'], ctx),
        }));
        try {
          // Run through the tool loop so a prompt that asks to (e.g.) search the
          // web can call tools; tool_choice 'auto' means simple prompts won't.
          const out = await agentTurn(model, [{ role: 'user', content: prompt }], 6, node.id, 'final-response', promptTools);
          lastOutput = out;
          ctx[node.id] = out;
          emit({ type: 'node-output', id: node.id, output: out });
        } catch (e) {
          emit({ type: 'node-error', id: node.id, message: String((e as Error)?.message || e) });
          return 'stop';
        }
        return 'continue';
      }
      if (node.type === 'output') {
        // Gate the final output BEFORE emitting it — a deny must block the
        // content from reaching the result, not flag it after it's already shown.
        const g = await enforceOutputGuardrails(lastOutput);
        if (g.stop) return 'stop';
        lastOutput = g.text;
        outputGuarded = true;
        emit({ type: 'node-start', id: node.id, nodeType: node.type, label });
        emit({ type: 'node-output', id: node.id, output: lastOutput });
        return 'continue';
      }

      // Mapper: pure JSON->JSON template substitution (no network). Other modes
      // (jq/expression) need the full engine — skipped with a note.
      if (node.type === 'transformer') {
        emit({ type: 'node-start', id: node.id, nodeType: node.type, label });
        const mode = asString(d.mode) || 'template';
        if (mode !== 'template') {
          emit({ type: 'node-skip', id: node.id, reason: `transform mode "${mode}" is not supported in the browser runner yet (template only).` });
          return 'continue';
        }
        ctx.input = lastOutput; ctx.previous_output = lastOutput;
        const inputVar = asString(d.inputVariable) || 'input';
        const tpl = asString(d.template);
        const scope = { ...ctx, [inputVar]: lastOutput };
        const out = tpl ? substitute(tpl, scope) : lastOutput;
        emit(inspectEvent(node.id, {
          settings: { mode, inputVariable: inputVar },
          user: out,
          vars: varsUsed([tpl], scope),
        }));
        lastOutput = out; ctx[node.id] = out;
        emit({ type: 'node-output', id: node.id, output: out });
        return 'continue';
      }

      // Guardrail: ask the model to judge the input, parse its verdict, gate flow.
      // On pass the input flows through unchanged; on fail the workflow stops.
      if (node.type === 'guardrail') {
        emit({ type: 'node-start', id: node.id, nodeType: node.type, label });
        // {{ input }} in the judge's prompt is the text being judged, like a mapper's.
        const sys = await resolvePromptField(d, 'systemPrompt', { ...ctx, input: lastOutput, previous_output: lastOutput });
        try {
          const raw = await complete(modelFor(d), [
            ...(sys ? [{ role: 'system' as const, content: sys }] : []),
            { role: 'user' as const, content: lastOutput || '(no input)' },
          ]);
          const verdict = parseVerdict(raw);
          const reason = asString(verdict.reason);
          const check = checkGuardrail(d, verdict, label);
          if (check.pass) {
            emit({ type: 'node-output', id: node.id, output: `guardrail passed${reason ? ` — ${reason}` : ''}`, note: true });
          } else {
            emit({ type: 'node-error', id: node.id, message: check.expressionError ?? `guardrail rejected${reason ? ` — ${reason}` : ''}` });
            return 'stop';
          }
        } catch (e) {
          emit({ type: 'node-error', id: node.id, message: String((e as Error)?.message || e) });
          return 'stop';
        }
        return 'continue';
      }

      // Agent: a composite (input guardrail -> tool-using agent -> output
      // guardrail). The middle step runs a bounded tool-use loop over the runner
      // tool subset (web search, compile, package search, memory/kv), capped by
      // maxIterations; the internal guardrails gate flow inline as before.
      if (node.type === 'agent') {
        emit({ type: 'node-start', id: node.id, nodeType: node.type, label });
        // Expose the upstream input under the agent's input variable (default
        // `input`, same as the main prompt) so the user prompt AND the guardrails
        // reference the same variable/value.
        const inputVar = asString(d.inputVariable) || 'input';
        ctx.input = lastOutput; ctx.previous_output = lastOutput; ctx[inputVar] = lastOutput;

        // Internal guardrails default to the agent's own model resolution unless
        // they carry an explicit override.
        const gModel = (cfg: Record<string, unknown>): string => (asString(cfg.model) ? modelFor(cfg) : modelFor(d));
        const runGuardrail = async (cfg: Record<string, unknown>, content: string, grLabel: string): Promise<{ pass: boolean; reason: string }> => {
          const gSys = await resolvePromptField(cfg, 'systemPrompt', ctx);
          const raw = await complete(gModel(cfg), [
            ...(gSys ? [{ role: 'system' as const, content: gSys }] : []),
            { role: 'user' as const, content: content || '(no input)' },
          ]);
          const verdict = parseVerdict(raw);
          const c = checkGuardrail(cfg, verdict, grLabel);
          return { pass: c.pass, reason: c.expressionError ?? asString(verdict.reason) };
        };

        try {
          // Compile the actual prompt that will run the agent first, so the input
          // guardrail judges THE SAME text the agent receives (not the raw
          // upstream value, which may be empty when the prompt comes from params).
          const sys = await resolvePromptField(d, 'systemPrompt', ctx);
          const user = substitute(asString(d.userPrompt) || `{{ ${inputVar} }}`, ctx);

          // Each sub-component reports in pipeline order: input guardrail →
          // agent (tool notes stream in between) → output guardrail.
          const ig = (d.inputGuardrail as Record<string, unknown>) || {};
          if (ig.enabled) {
            const v = await runGuardrail(ig, user, `${label} input guardrail`);
            if (!v.pass) {
              emit({ type: 'node-error', id: node.id, message: `input guardrail rejected${v.reason ? ` — ${v.reason}` : ''}` });
              return 'stop';
            }
            emit({ type: 'node-output', id: node.id, output: `passed${v.reason ? ` — ${v.reason}` : ''}`, sub: 'input guardrail' });
          }

          const maxIter = Math.max(1, Math.min(Number(d.maxIterations) || 6, 12));
          const agentModel = chainModel(d);
          const agentTools = toolsFor(node.id);
          emit(inspectEvent(node.id, {
            model: agentModel,
            settings: {
              maxIterations: maxIter,
              outputMode: asString(d.outputMode) || 'final-response',
              inputVariable: inputVar,
              inputGuardrail: !!ig.enabled,
              outputGuardrail: !!(d.outputGuardrail as Record<string, unknown> | undefined)?.enabled,
              ...(agentTools ? { tools: agentTools.join(', ') } : {}),
            },
            system: sys,
            user,
            vars: varsUsed([asString(d.systemPrompt), asString(d.userPrompt) || `{{ ${inputVar} }}`], ctx),
          }));
          const out = await agentTurn(agentModel, [
            ...(sys ? [{ role: 'system' as const, content: sys }] : []),
            { role: 'user' as const, content: user },
          ], maxIter, node.id, asString(d.outputMode) || 'final-response', toolsFor(node.id));

          // Emitted before the output guardrail's verdict so the order reads
          // truthfully — and a rejection still shows WHAT was rejected.
          emit({ type: 'node-output', id: node.id, output: out });

          const og = (d.outputGuardrail as Record<string, unknown>) || {};
          if (og.enabled) {
            const v = await runGuardrail(og, out, `${label} output guardrail`);
            if (!v.pass) {
              emit({ type: 'node-error', id: node.id, message: `output guardrail rejected${v.reason ? ` — ${v.reason}` : ''}` });
              return 'stop';
            }
            emit({ type: 'node-output', id: node.id, output: `passed${v.reason ? ` — ${v.reason}` : ''}`, sub: 'output guardrail' });
          }

          lastOutput = out; ctx[node.id] = out;
        } catch (e) {
          emit({ type: 'node-error', id: node.id, message: String((e as Error)?.message || e) });
          return 'stop';
        }
        return 'continue';
      }

      // Debug node: observe-only. Logs a configurable view of the run state and
      // passes the input through unchanged. What: input passthrough / full scope /
      // a {{ }} message. When: an optional `condition` (log only when truthy).
      if (node.type === 'checkpoint' || node.type === 'callback') {
        emit({ type: 'node-start', id: node.id, nodeType: node.type, label });
        const scope = { ...ctx, input: lastOutput, previous_output: lastOutput, nodes: ctx };
        const name = asString(d.checkpointName).trim() || label;
        const tag = name ? `[${name}] ` : '';
        let shouldLog: boolean;
        try {
          shouldLog = evalWorkflowCondition(asString(d.condition), scope);
        } catch (e) {
          if (isExpressionError(e)) { emit({ type: 'node-error', id: node.id, message: describeExpressionFailure('Debug condition', label, e) }); return 'stop'; }
          throw e;
        }
        if (!shouldLog) {
          emit({ type: 'node-output', id: node.id, output: `${tag}skipped (condition not met)`, note: true });
          return 'continue';
        }
        const parts: string[] = [];
        if (asString(d.message).trim()) parts.push(substitute(asString(d.message), scope));
        if (d.includePreviousOutput !== false) parts.push(lastOutput ? `observed:\n${lastOutput}` : 'observed (no input yet)');
        if (d.logScope) parts.push(`scope:\n${safeJson(scope)}`);
        emit({ type: 'node-output', id: node.id, output: `${tag}${parts.join('\n\n') || '(nothing to log)'}`, note: true });
        return 'continue';
      }

      // User input: collect a value mid-run through host.requestInput, queued so
      // parallel branches never open two prompts at once.
      if (node.type === 'user-input') {
        emit({ type: 'node-start', id: node.id, nodeType: node.type, label });
        const msg = substitute(asString(d.prompt) || 'Enter input:', { ...ctx, input: lastOutput, previous_output: lastOutput });
        const inputType = (asString(d.inputType) || 'text') as WfInputRequest['inputType'];
        const options = Array.isArray(d.options) ? (d.options as unknown[]).map(asString).filter(Boolean) : undefined;
        const required = d.required !== false;
        const val = await askInput({
          nodeId: node.id, prompt: msg, inputType, options,
          placeholder: asString(d.placeholder) || undefined,
          required, defaultValue: asString(d.defaultValue) || undefined,
          context: d.showContext ? (lastOutput || undefined) : undefined,
        });
        if (signal?.aborted) { emit({ type: 'error', message: 'Aborted' }); return 'stop'; }
        if (val == null && required) {
          emit({ type: 'node-error', id: node.id, message: 'input required — cancelled' });
          return 'stop';
        }
        let out = val ?? '';
        // User-input is user input too — run it through the input guardrails
        // (scrub rewrites the entered value) before it flows downstream.
        const gr = await enforceInputGuardrails(`${GR_IN}:${node.id}`, `Input guardrails · ${label}`, out, async (scrubOne) => { out = await scrubOne(out); });
        if (gr === 'deny') return 'stop';
        lastOutput = out; ctx[node.id] = out;
        emit({ type: 'node-output', id: node.id, output: out });
        return 'continue';
      }

      // API: a REST call with templated url/headers/body, made through host.fetch
      // (which applies the host's outbound guard; a browser host is also subject to
      // CORS). Response text flows on.
      if (node.type === 'api') {
        emit({ type: 'node-start', id: node.id, nodeType: node.type, label });
        ctx.input = lastOutput; ctx.previous_output = lastOutput;
        const method = (asString(d.method) || 'GET').toUpperCase();
        const url = substitute(asString(d.url), ctx).trim();
        if (!url) { emit({ type: 'node-skip', id: node.id, reason: 'no URL set.' }); return 'continue'; }
        // The SSRF guard lives in host.fetch (templated url/headers carry upstream
        // output, so they are untrusted); a refusal arrives as WorkflowBlockedError.
        const headers: Record<string, string> = {};
        const rawHeaders = d.headers && typeof d.headers === 'object' ? (d.headers as Record<string, unknown>) : {};
        // Strip CR/LF from templated header values so an injected newline can't
        // smuggle extra headers / split the request.
        for (const [k, v] of Object.entries(rawHeaders)) { if (k.trim()) headers[k] = substitute(asString(v), ctx).replace(/[\r\n]/g, ''); }
        const bodyTpl = asString(d.body);
        const hasBody = method !== 'GET' && method !== 'HEAD' && bodyTpl.trim().length > 0;
        try {
          const res = await host.fetch(url, { method, headers, ...(hasBody ? { body: substitute(bodyTpl, ctx) } : {}), signal });
          if (res.status < 200 || res.status >= 300) {
            emit({ type: 'node-error', id: node.id, message: `HTTP ${res.status} ${res.statusText}${res.text ? ` — ${res.text.slice(0, 200)}` : ''}` });
            return 'stop';
          }
          lastOutput = res.text; ctx[node.id] = res.text;
          emit({ type: 'node-output', id: node.id, output: res.text });
        } catch (e) {
          if (isWorkflowBlockedError(e)) { emit({ type: 'node-error', id: node.id, message: `blocked: ${e.message}` }); return 'stop'; }
          emit({ type: 'node-error', id: node.id, message: `request failed (CORS or network?): ${String((e as Error)?.message || e)}` });
          return 'stop';
        }
        return 'continue';
      }

      // Loop: repeat the body sub-chain. for-each over a list ({{ items }} — a JSON
      // array or a newline list), `count` times, or `while` an expression holds —
      // all capped by maxIterations. The body runs imperatively here (it's off the
      // main spine walk); the loop's output is each pass collected.
      if (node.type === 'loop') {
        emit({ type: 'node-start', id: node.id, nodeType: node.type, label });
        const body = (Array.isArray(d.body) ? (d.body as string[]) : [])
          .map((bid) => byId.get(bid)).filter((bn): bn is WorkflowNode => !!bn);
        if (body.length === 0) {
          emit({ type: 'node-output', id: node.id, output: 'empty loop body — skipped', note: true });
          return 'continue';
        }
        const loopType = asString(d.loopType) || 'for-each';
        const itemVar = asString(d.itemVariable) || 'item';
        const maxIter = Math.max(1, Math.min(Number(d.maxIterations) || 100, 1000));
        let items: unknown[] = [];
        if (loopType === 'for-each') {
          let raw = substitute(asString(d.items), { ...ctx, input: lastOutput, previous_output: lastOutput }).trim();
          // A model asked for "ONLY a JSON array" still often fences it; unfenced,
          // the newline fallback below would iterate over "```json", "[", ...
          const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw);
          if (fenced) raw = fenced[1].trim();
          if (raw) {
            try { const v = JSON.parse(raw); items = Array.isArray(v) ? v : [v]; }
            catch { items = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean); }
          }
        } else if (loopType === 'count') {
          items = Array.from({ length: Math.max(0, Math.min(Number(d.count) || 0, maxIter)) }, (_, i) => i);
        }
        const collected: string[] = [];
        let i = 0;
        while (i < maxIter) {
          if (signal?.aborted) { emit({ type: 'error', message: 'Aborted' }); return 'stop'; }
          if (loopType === 'while') {
            let cont: boolean;
            try {
              cont = evalWorkflowCondition(asString(d.condition), { ...ctx, input: lastOutput, previous_output: lastOutput, loop_index: i, nodes: ctx });
            } catch (e) {
              if (isExpressionError(e)) { emit({ type: 'node-error', id: node.id, message: describeExpressionFailure('Loop condition', label, e) }); return 'stop'; }
              throw e;
            }
            if (!cont) break;
          } else if (i >= items.length) {
            break;
          }
          ctx[itemVar] = loopType === 'while' ? i : items[i];
          ctx.loop_index = i;
          for (const bn of body) {
            const r = await executeNode(bn);
            if (r === 'stop') return 'stop';
          }
          collected.push(lastOutput);
          i += 1;
        }
        // collect: 'text' joins the passes into one readable string - identical to
        // the CLI engine's joinLoopResults (prompd-cli workflowExecutor.ts) - so a
        // list of drafts reaches the user as text, not a JSON array of escapes.
        const out = d.collect === 'text'
          ? collected.join(typeof d.separator === 'string' ? d.separator : '\n\n')
          : collected.length === 0 ? lastOutput : collected.length === 1 ? collected[0] : safeJson(collected);
        lastOutput = out; ctx[node.id] = out;
        emit({ type: 'node-output', id: node.id, output: `looped ${i}×`, note: true });
        return 'continue';
      }

      // Parallel (fork mode): each branch runs in its own frame (a copy of this
      // scope, its own abort signal), scheduled by core's runBranches under the
      // node's wait policy; losers are aborted and go silent. The join node (where
      // the branches' input-* edges land) receives the merged result.
      if (node.type === 'parallel') {
        emit({ type: 'node-start', id: node.id, nodeType: node.type, label });
        if (asString(d.mode) !== 'fork') {
          emit({ type: 'node-skip', id: node.id, reason: 'broadcast (container) parallel runs in the CLI only - use fork mode' });
          return 'continue';
        }
        const specs = traceForkBranches(parsed.file, node.id);
        if (specs.length === 0) {
          emit({ type: 'node-output', id: node.id, output: 'no branches - passing input through', note: true });
          ctx[node.id] = lastOutput;
          return 'continue';
        }
        const nested = specs.flatMap((s) => s.nodeIds).map((id) => byId.get(id))
          .find((bn): bn is WorkflowNode => !!bn && CONTAINER_TYPES.has(bn.type));
        if (nested) {
          emit({ type: 'node-error', id: node.id, message: `nested containers are not supported inside a parallel branch (${nodeLabel(nested)})` });
          return 'stop';
        }
        const waitFor = WAIT_MODES.find((w) => w === d.waitFor) ?? 'all';
        const strategy = MERGE_STRATEGIES.find((s) => s === d.mergeStrategy) ?? 'object';
        const frames = new Map<string, Frame>();
        const outcome = await runBranches(specs, async (spec, branchSignal) => {
          const child = createFrame({ ctx: { ...ctx }, lastOutput, signal: branchSignal, currentModel, rerouteModel, contained: true });
          frames.set(spec.key, child);
          for (const id of spec.nodeIds) {
            if (branchSignal.aborted) throw new Error('cancelled');
            const bn = byId.get(id);
            if (!bn) continue;
            const r = await child.executeNode(bn);
            if (r === 'stop') { child.flush(); throw new Error(child.lastError() || `${nodeLabel(bn)} failed`); }
          }
          child.flush();
          return child.output();
        }, {
          waitFor,
          quorumCount: typeof d.quorumCount === 'number' ? d.quorumCount : undefined,
          maxConcurrency: typeof d.maxConcurrency === 'number' ? d.maxConcurrency : undefined,
          timeoutMs: typeof d.branchTimeoutMs === 'number' ? d.branchTimeoutMs : undefined,
          signal,
        });
        const why = (status: string): string =>
          status === 'timeout' ? 'timed out' : signal?.aborted ? 'run stopped' : 'lost the race';
        for (const r of outcome.results) {
          if (r.status !== 'cancelled' && r.status !== 'timeout') continue;
          const inFlight = frames.get(r.key)?.currentId();
          if (inFlight) rawEmit({ type: 'node-skip', id: inFlight, reason: `cancelled - ${r.label} ${why(r.status)}` });
        }
        emit({
          type: 'node-output', id: node.id, note: true,
          output: outcome.results.map((r) => `${r.label}: ${r.status} (${Math.round(r.ms)}ms)`).join(' | '),
        });
        // Only the branches the wait policy selected publish their node outputs
        // back to this scope (so downstream `{{ nodeId }}` sees the winners only).
        for (const r of outcome.selected) {
          if (r.status !== 'ok') continue;
          const child = frames.get(r.key);
          const spec = specs.find((s) => s.key === r.key);
          if (!child || !spec) continue;
          for (const id of spec.nodeIds) if (id in child.ctx) ctx[id] = child.ctx[id];
        }
        if (!outcome.ok) {
          emit({ type: 'node-error', id: node.id, message: outcome.error || 'parallel node failed' });
          return 'stop';
        }
        const merged = mergeBranchResults(outcome, strategy);
        lastOutput = typeof merged === 'string' ? merged : safeJson(merged);
        ctx[node.id] = lastOutput;
        emit({ type: 'node-output', id: node.id, output: lastOutput });
        return 'continue';
      }

      emit({ type: 'node-skip', id: node.id, reason: `node type "${node.type}" is not supported in the browser runner yet.` });
      return 'continue';
    };

    // Advance from a node: a condition follows its recorded route; output ends the
    // run; every other node follows its single out-edge.
    const nextNode = (node: WorkflowNode): WorkflowNode | undefined => {
      if (node.type === 'output') return undefined;
      if (node.type === 'condition') {
        const target = condRoute.get(node.id);
        return target ? byId.get(target) : undefined;
      }
      // A parallel ran its branches itself; resume at the join.
      if (node.type === 'parallel') {
        const j = forkJoinId(parsed.file, node.id);
        return j ? byId.get(j) : undefined;
      }
      // A loop ran its body itself; resume at the merge, skipping the body edges.
      if (node.type === 'loop') {
        const oc = asString(dataOf(node).onComplete);
        return oc ? byId.get(oc) : undefined;
      }
      const e = outBySource.get(node.id)?.[0];
      return e ? byId.get(e.target) : undefined;
    };

    return {
      ctx,
      executeNode,
      nextNode,
      output: () => lastOutput,
      currentId: () => currentId,
      lastError: () => lastErrorMsg,
      outputGuarded: () => outputGuarded,
      enforceInputGuardrails,
      enforceOutputGuardrails,
      flush: flushNodeEnd,
    };
  };

  const root = createFrame({ ctx: { ...paramValues }, lastOutput: '', signal, currentModel: wfDefault, rerouteModel: '', contained: false });

  try {
    // Input guardrails — DETECT over every run parameter (non-strings stringified,
    // so PII can't slip through a number/object param); SCRUB rewrites the string
    // params in place (a number's type is preserved — detection still gates it).
    {
      const all = Object.entries(paramValues).filter(([, v]) => v != null && String(v).trim().length > 0);
      const strings = all.filter((e): e is [string, string] => typeof e[1] === 'string');
      const r = await root.enforceInputGuardrails(GR_IN, 'Input guardrails', all.map(([, v]) => String(v)).join('\n\n'), async (scrubOne) => {
        for (const [k, v] of strings) { const cleaned = await scrubOne(v); paramValues[k] = cleaned; root.ctx[k] = cleaned; }
      });
      if (r === 'deny') return;
    }

    // Walk from the trigger (fallback: the first non-provider node), executing each
    // node and following the chosen edge. The visited guard makes a malformed cycle
    // terminate instead of hanging.
    let cur: WorkflowNode | undefined =
      parsed.file.nodes.find((n) => n.type === 'trigger')
      ?? parsed.file.nodes.find((n) => n.type !== 'provider');
    const visited = new Set<string>();
    while (cur) {
      if (signal?.aborted) { root.flush(); rawEmit({ type: 'error', message: 'Aborted' }); return; }
      if (visited.has(cur.id)) break;
      visited.add(cur.id);
      const res = await root.executeNode(cur);
      if (res === 'stop') return;
      cur = root.nextNode(cur);
    }

    // Fallback for chains that end without an output node: gate the final output
    // before reporting it.
    let finalOutput = root.output();
    if (!root.outputGuarded()) {
      const g = await root.enforceOutputGuardrails(finalOutput);
      if (g.stop) return;
      finalOutput = g.text;
    }
    root.flush();
    rawEmit({ type: 'done', finalOutput });
  } catch (e) {
    root.flush();
    rawEmit({ type: 'error', message: String((e as Error)?.message || e) });
  }
}
