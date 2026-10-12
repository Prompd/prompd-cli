/* The tool allowlist granted to a node's agent turn: the union of the node's own
 * `data.tools` and any attached Tools node's `data.tools`. Null when neither
 * grants tools (the host then uses its read-only default). */
import type { WorkflowFile, WorkflowNode } from '../workflowTypes'

const dataOf = (n: WorkflowNode): Record<string, unknown> => (n.data ?? {}) as unknown as Record<string, unknown>
const asString = (v: unknown): string => (typeof v === 'string' ? v : '')
const toList = (v: unknown): string[] => (Array.isArray(v) ? v.map(asString).filter(Boolean) : [])

export function nodeToolNames(file: WorkflowFile, nodeId: string): string[] | null {
  const nodes = file.nodes || []
  const self = nodes.find((n) => n.id === nodeId)
  const own = self ? toList(dataOf(self).tools) : []
  const attached: string[] = []
  for (const n of nodes) {
    if (n.type === 'tool' && asString(dataOf(n).attachedTo) === nodeId) attached.push(...toList(dataOf(n).tools))
  }
  const union = Array.from(new Set([...own, ...attached]))
  return union.length ? union : null
}
