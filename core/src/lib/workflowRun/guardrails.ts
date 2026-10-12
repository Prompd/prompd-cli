/* Guardrail types and evaluation. Pure and injectable: the engine wires the real
 * model judge, tests use a fake. Shared by the guardrail node, the agent's
 * internal guardrails, and workflow-level guardrails (strict first-hit-wins).
 * A NON-pass verdict is a "hit": the violation the rule's action responds to. */
import { evaluateExpression, isExpressionError, describeExpressionFailure } from '../expression'

/** What a guardrail does when it hits. */
export type GuardrailAction = 'deny' | 'scrub' | 'reroute' | 'warn'

/** One workflow-level guardrail rule (stored in the .pdflow's top-level
 * `guardrails`). `target` is the model for scrub/reroute. */
export interface WorkflowGuardrail {
  id: string
  /** Preset id this was created from ('pii' | 'phi' | 'custom' | ...). */
  preset?: string
  /** Display label (defaults to the preset label). */
  label?: string
  /** Hidden detection prompt. */
  systemPrompt: string
  passExpression?: string
  scoreThreshold?: number
  action: GuardrailAction
  /** Provider + model for scrub (the rewriter) / reroute (the new run model). */
  target?: { providerId?: string; model?: string }
  /** Optional override for the scrub instruction (defaults derived from systemPrompt). */
  scrubPrompt?: string
  /** Disable without removing. */
  disabled?: boolean
}

/** Workflow-level guardrails: input runs on start, output before the final result. */
export interface WorkflowGuardrails {
  input: WorkflowGuardrail[]
  output: WorkflowGuardrail[]
}

/** Parse a guardrail/evaluator LLM reply into a verdict object. Tolerates ```json
 * fences; non-JSON replies are wrapped as { response }. */
export function parseVerdict(raw: string): Record<string, unknown> {
  const t = (raw || '').trim()
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced ? fenced[1] : t).trim()
  try {
    const v = JSON.parse(body) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : { response: raw }
  } catch {
    return { response: raw }
  }
}

/** `pass` decides flow; `expressionError` is set only when a passExpression
 * REJECTED (a disallowed construct, a syntax error), never for an ordinary
 * non-pass verdict. */
export interface GuardrailCheck {
  pass: boolean
  expressionError?: string
}

/** A guardrail's pass/fail from its verdict: passExpression first, then
 * scoreThreshold, then a `pass`/`rejected` flag. A rejected expression FAILS
 * CLOSED and reports why. An unreadable verdict fails closed. */
export function checkGuardrail(
  d: { passExpression?: unknown; scoreThreshold?: unknown },
  verdict: Record<string, unknown>,
  label = 'guardrail',
): GuardrailCheck {
  const expr = String(d.passExpression ?? '').replace(/^\{\{\s*|\s*\}\}$/g, '').trim()
  if (expr) {
    try {
      return { pass: !!evaluateExpression(expr, verdict) }
    } catch (e) {
      if (isExpressionError(e)) return { pass: false, expressionError: describeExpressionFailure('Guardrail', label, e) }
      throw e
    }
  }
  if (d.scoreThreshold != null) {
    const score = Number(verdict.score)
    return { pass: Number.isFinite(score) && score >= Number(d.scoreThreshold) }
  }
  if ('pass' in verdict) return { pass: !!verdict.pass }
  if ('rejected' in verdict) return { pass: !verdict.rejected }
  return { pass: false }
}

/** Boolean-only view of checkGuardrail. */
export function evalGuardrail(d: { passExpression?: unknown; scoreThreshold?: unknown }, verdict: Record<string, unknown>): boolean {
  return checkGuardrail(d, verdict).pass
}

/** A judge: run a guardrail's detection prompt over `text`, returning the verdict. */
export type GuardrailJudge = (rule: WorkflowGuardrail, text: string) => Promise<Record<string, unknown>>

/** Strict first-hit-wins: evaluate enabled rules in order and return the FIRST
 * violation; later rules are not evaluated. Null when nothing hits. */
export async function firstGuardrailHit(
  rules: WorkflowGuardrail[],
  text: string,
  judge: GuardrailJudge,
): Promise<{ rule: WorkflowGuardrail; verdict: Record<string, unknown> } | null> {
  for (const rule of rules) {
    if (rule.disabled) continue
    const verdict = await judge(rule, text)
    const check = checkGuardrail(rule, verdict, rule.label || rule.id)
    if (!check.pass) return { rule, verdict: check.expressionError ? { ...verdict, reason: check.expressionError } : verdict }
  }
  return null
}
