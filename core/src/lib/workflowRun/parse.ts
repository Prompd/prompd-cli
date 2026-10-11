/* .pdflow text -> ParsedWorkflow, with errors and warnings as display strings. */
import { parseWorkflow, type ParsedWorkflow } from '../workflowParser'

export interface ParseResult {
  parsed: ParsedWorkflow | null
  errors: string[]
  warnings: string[]
}

export function parseWorkflowJson(text: string): ParseResult {
  try {
    const parsed = parseWorkflow(text)
    const errors = (parsed.errors || []).map((e) => e.message)
    // Off-chain nodes are intentionally not on the flow line: the Provider (nodes
    // reference it via providerNodeId) and Tools nodes (attached to one host via
    // data.attachedTo). Drop their "disconnected" warnings.
    const offChainIds = new Set((parsed.file?.nodes || []).filter((n) => n.type === 'provider' || n.type === 'tool').map((n) => n.id))
    const warnings = (parsed.warnings || [])
      .filter((w) => !(w && w.nodeId && offChainIds.has(w.nodeId)))
      .map((w) => w.message)
    return { parsed, errors, warnings }
  } catch (e) {
    return { parsed: null, errors: [`Invalid .pdflow: ${String((e as Error)?.message || e)}`], warnings: [] }
  }
}
