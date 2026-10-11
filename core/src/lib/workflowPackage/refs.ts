/* The file references a .pdflow and a .prmd make: the ONE walk the workflow
 * tracer, the CLI packager and the sidecar deploy share. Pure: no I/O. Refs are
 * returned raw (unresolved); the tracer resolves them against the referring
 * file's folder. */
import * as yaml from 'yaml'

export interface FileRefs {
  files: string[]
  packageRefs: string[]
}

/** A registry package reference rather than a workspace file: `@scope/...`,
 * `scope/name@version/...`, or an alias form containing ':' (the engine skips
 * these the same way). */
export function isPackageRef(ref: string): boolean {
  return ref.startsWith('@') || /^[\w.-]+\/[\w.-]+@/.test(ref) || ref.includes(':')
}

const SECTION_FIELDS = ['system', 'user', 'task', 'assistant', 'response', 'output'] as const

/** Prompt node `source` (unless `sourceType: 'raw'`), sub-workflow
 * `workflowPath` (or `source`), and file-backed system prompts on guardrail and
 * agent nodes and an agent's internal guardrails (`systemPromptFile` when
 * `systemPromptSource` is 'file', or unset with a file present: the engine's
 * own rule). */
export function workflowNodeRefs(file: unknown): FileRefs {
  const files: string[] = []
  const packageRefs: string[] = []
  const nodes = file && typeof file === 'object' && Array.isArray((file as { nodes?: unknown }).nodes)
    ? (file as { nodes: unknown[] }).nodes
    : []
  const add = (ref: unknown): void => {
    if (typeof ref !== 'string' || !ref.trim()) return
    const r = ref.trim().replace(/\\/g, '/')
    if (isPackageRef(r)) packageRefs.push(r)
    else files.push(r)
  }
  const promptField = (obj: unknown, key: string): void => {
    if (!obj || typeof obj !== 'object') return
    const o = obj as Record<string, unknown>
    const filePath = o[`${key}File`]
    const declared = o[`${key}Source`]
    const mode = typeof declared === 'string' && declared ? declared : (typeof filePath === 'string' && filePath ? 'file' : 'inline')
    if (mode === 'file') add(filePath)
  }
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue
    const { type, data } = n as { type?: unknown; data?: unknown }
    const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
    if (type === 'prompt' && d.sourceType !== 'raw') add(d.source)
    if (type === 'workflow') add(d.workflowPath ?? d.source)
    if (type === 'guardrail' || type === 'agent') promptField(d, 'systemPrompt')
    if (type === 'agent') {
      promptField(d.inputGuardrail, 'systemPrompt')
      promptField(d.outputGuardrail, 'systemPrompt')
    }
  }
  return { files, packageRefs }
}

/** A .prmd/.md's local file references: section fields (system, user, task,
 * assistant, response, output), context/contexts and override values when they
 * are ./ or ../ paths; inherits (local, or a package ref when @-prefixed); and
 * {% include %} targets. Bare inherits/include names are folder-relative. */
export function prmdFileRefs(text: string): FileRefs {
  const files: string[] = []
  const packageRefs: string[] = []
  const content = text.replace(/\r\n/g, '\n')
  const fm = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return { files, packageRefs }
  let meta: Record<string, unknown> = {}
  try {
    const v = yaml.parse(fm[1]) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) meta = v as Record<string, unknown>
  } catch {
    return { files, packageRefs }
  }
  const pathRef = (v: unknown): void => {
    if (typeof v === 'string' && (v.startsWith('./') || v.startsWith('../'))) files.push(v)
  }
  const folderRef = (v: string): void => {
    if (v.startsWith('@')) packageRefs.push(v)
    else files.push(v.startsWith('./') || v.startsWith('../') || v.startsWith('/') ? v : `./${v}`)
  }
  for (const f of SECTION_FIELDS) {
    const v = meta[f]
    for (const r of Array.isArray(v) ? v : [v]) pathRef(r)
  }
  const ctx = meta.context ?? meta.contexts
  for (const r of Array.isArray(ctx) ? ctx : ctx !== undefined ? [ctx] : []) pathRef(r)
  const ov = meta.override
  if (ov && typeof ov === 'object' && !Array.isArray(ov)) {
    for (const v of Object.values(ov as Record<string, unknown>)) pathRef(v)
  }
  const inherits = meta.inherits
  if (typeof inherits === 'string' && inherits.trim()) folderRef(inherits.trim())
  const body = content.slice(fm[0].length)
  const includeRe = /\{%-?\s*include\s+["']([^"']+)["']\s*-?%\}/g
  let m: RegExpExecArray | null
  while ((m = includeRe.exec(body)) !== null) folderRef(m[1])
  return { files, packageRefs }
}
