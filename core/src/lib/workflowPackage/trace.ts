/* Every local file a workflow (or a prompt) uses, read through an async reader so
 * the browser passes its FileService and the CLI passes Node fs. Recursive and
 * cycle-safe. A path that escapes the workspace is reported missing and never
 * handed to the reader. */
import { normalizeWorkspacePath, resolveFlowFileRef } from '../workflowRun/paths'
import { workflowNodeRefs, prmdFileRefs, type FileRefs } from './refs'

/** Read a workspace-relative path; null when it does not exist. */
export type WorkflowFileReader = (path: string) => Promise<string | null>

export interface WorkflowTrace {
  /** Files found, including the entry. Sorted. */
  files: string[]
  /** Referenced but unreadable (absent, unreadable, or outside the workspace). Sorted. */
  missing: string[]
  /** Registry package references, which a host without a resolver cannot run. Sorted. */
  packageRefs: string[]
}

const escapesWorkspace = (p: string): boolean => p === '..' || p.startsWith('../')
const isPromptPath = (p: string): boolean => /\.(prmd|md)$/i.test(p)

function parseJson(text: string): unknown {
  try { return JSON.parse(text) as unknown } catch { return null }
}

function refsOf(path: string, text: string): FileRefs {
  if (path.toLowerCase().endsWith('.pdflow')) return workflowNodeRefs(parseJson(text))
  if (isPromptPath(path)) return prmdFileRefs(text)
  return { files: [], packageRefs: [] }
}

export async function traceWorkflowFiles(read: WorkflowFileReader, entryPath: string): Promise<WorkflowTrace> {
  const files = new Set<string>()
  const missing = new Set<string>()
  const packageRefs = new Set<string>()
  const seen = new Set<string>()
  const queue: string[] = [normalizeWorkspacePath(entryPath)]
  while (queue.length) {
    const p = queue.shift() as string
    if (seen.has(p)) continue
    seen.add(p)
    if (escapesWorkspace(p)) { missing.add(p); continue }
    let text: string | null
    try { text = await read(p) } catch { text = null }
    if (text === null) { missing.add(p); continue }
    files.add(p)
    const refs = refsOf(p, text)
    for (const r of refs.packageRefs) packageRefs.add(r)
    for (const r of refs.files) queue.push(resolveFlowFileRef(p, r))
  }
  const sorted = (s: Set<string>): string[] => [...s].sort()
  return { files: sorted(files), missing: sorted(missing), packageRefs: sorted(packageRefs) }
}
