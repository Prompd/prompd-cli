/* The workflow host: everything the engine cannot do without a platform. Core
 * defines it and imports nothing platform-specific; the browser and the sidecar
 * each build one (spec 2026-10-11 section 4.2). */
import type { WfInputRequest } from './model'

/** One tool call a model asked for. `arguments` is the raw JSON string. */
export interface WfToolCall {
  id: string
  name: string
  arguments: string
}

/** One message in a model conversation. Minimal on purpose: core does not depend
 * on any provider SDK; each host converts to and from its client's shape. */
export type WfMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: WfToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string }

/** A tool the model may call. `parameters` is a JSON Schema object. */
export interface WfToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** What a tool call produced, as the text the model sees. A denial or a failure
 * is also a result, never a throw. */
export interface WfToolResult {
  content: string
}

export interface WfUsage {
  inputTokens: number
  outputTokens: number
}

/** One self-healing event (a retry, a steer, a give-up), for host telemetry. */
export interface WfHealRecord {
  site: 'stream' | 'tool'
  tool?: string
  kind: string
  strategy: string
  attempt: number
  outcome: string
  error: string
  model?: string
  nodeId?: string
}

/** A transient model failure the host is about to retry. */
export interface WfRetryInfo {
  /** 1-based retry attempt. */
  attempt: number
  /** The backoff the host is about to sleep. */
  delayMs: number
  /** The failure's message. */
  reason: string
  /** The host's retry budget, for the run pane's "retrying (n/max)" note. */
  maxRetries: number
}

export interface WfCallModelRequest {
  model: string
  messages: WfMessage[]
  tools?: WfToolDef[]
  temperature?: number
  signal?: AbortSignal
  onDelta?(text: string): void
  /** Called by the host before each backoff sleep of a retry (owner ruling 2026-10-11). */
  onRetry?(info: WfRetryInfo): void
}

export interface WfModelTurn {
  content: string
  toolCalls: WfToolCall[]
  usage?: WfUsage
}

export interface WorkflowHost {
  /** One model turn. The host owns the client, auth, streaming, retry and backoff,
   * and reports each retry through req.onRetry before sleeping. */
  callModel(req: WfCallModelRequest): Promise<WfModelTurn>
  /** The tool definitions a node may use, by the names nodeToolNames() allows
   * (null = the host's read-only default set). */
  toolsFor(names: string[] | null): WfToolDef[]
  /** Run one tool call. The host owns lookup, policy (deny list, budget), feature
   * guards, approval, and failure classification; a denial or failure is
   * returned as text the model sees, never thrown. */
  runTool(call: WfToolCall, ctx: { nodeId: string; signal?: AbortSignal }): Promise<WfToolResult>
  /** Compile a .prmd (by workspace path) or inline prompt text with these vars.
   * A host with no workspace throws WorkflowNoWorkspaceError for a path. */
  compilePrompt(src: { path: string } | { text: string }, vars: Record<string, unknown>): Promise<string>
  /** An api node's request. The host applies its outbound URL guard and throws
   * WorkflowBlockedError when it refuses. */
  fetch(
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
  ): Promise<{ status: number; statusText: string; text: string }>
  /** The model a node runs on: node setting, else workflow default, else the host's. */
  resolveModel(nodeModel: string | undefined, workflowModel: string | undefined): string
  /** Price per million tokens, for node-end cost; null when unknown. */
  priceOf(model: string): { input: number; output: number } | null
  /** The redaction prompt template for scrub steps. The engine compiles it with
   * compilePrompt({ text }, { policy }). */
  redactionPrompt(): Promise<string>
  /** A user-input node. Null = no answer (headless hosts return null). */
  requestInput(req: WfInputRequest): Promise<string | null>
  /** Optional telemetry for self-healing. The engine forwards each retry the
   * host reports through onRetry here, with the node and model. */
  onHeal?(rec: WfHealRecord): void
}

/** Thrown by host.fetch when its outbound URL guard refuses the request. */
export class WorkflowBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowBlockedError'
  }
}

/** Thrown by host.compilePrompt for a path when the host has no workspace. */
export class WorkflowNoWorkspaceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowNoWorkspaceError'
  }
}

/* Checked by name, not instanceof: a host may sit behind a second copy of core
 * (bundles, workers), where instanceof is false for the same error. */
export function isWorkflowBlockedError(e: unknown): e is WorkflowBlockedError {
  return e instanceof Error && e.name === 'WorkflowBlockedError'
}

export function isWorkflowNoWorkspaceError(e: unknown): e is WorkflowNoWorkspaceError {
  return e instanceof Error && e.name === 'WorkflowNoWorkspaceError'
}
