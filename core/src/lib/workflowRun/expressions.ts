/* Workflow expressions: condition/debug/loop `{{ ... }}` expressions over the run
 * scope, evaluated by core's safe subset evaluator (never `new Function`/`eval`).
 * A rejected or invalid expression THROWS (ExpressionError); callers fail their
 * node loudly rather than treating a broken expression as true or false. */
import { evaluateExpression } from '../expression'

/** Blank (after stripping one surrounding `{{ }}`) is always true: a node with no
 * condition runs unconditionally. Otherwise evaluated over `scope`, coerced to
 * boolean. Throws ExpressionError unchanged. */
export function evalWorkflowCondition(expr: string, scope: Record<string, unknown>): boolean {
  const e = expr.replace(/^\{\{\s*|\s*\}\}$/g, '').trim()
  if (!e) return true
  return !!evaluateExpression(e, scope)
}
