/* Text helpers shared by the workflow engine and prompd-web's strategy runner. */
import type { WfMessage } from './host'

/** {{ token }} substitution for .pdflow prompts: THE one implementation, so the
 * same file renders identically under every engine (objects always JSON,
 * `in`-check for absent keys). */
export function substitute(template: string, ctx: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    if (!(key in ctx)) return ''
    const v = ctx[key]
    if (v == null) return ''
    if (typeof v === 'string') return v
    return typeof v === 'object' ? JSON.stringify(v) : String(v)
  })
}

/** Flatten an agent's message history into a readable transcript (drops the
 * system prompt). Used by the agent node's `outputMode: 'full-conversation'`. */
export function renderConversation(messages: readonly WfMessage[]): string {
  const parts: string[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'tool') {
      if (m.content) parts.push(`[tool] ${m.content}`)
      continue
    }
    if (m.content) parts.push(`${m.role}: ${m.content}`)
    if (m.role === 'assistant' && m.toolCalls?.length) {
      parts.push(`${m.role} → ${m.toolCalls.map((c) => c.name).filter(Boolean).join(', ')}`)
    }
  }
  return parts.join('\n\n')
}
