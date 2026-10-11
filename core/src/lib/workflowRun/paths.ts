/* Workspace path helpers for workflow file references. Posix only, no Node. */
import { dirnamePosix, resolvePosix } from '../compiler/path-utils'

/** Forward slashes, no leading ./ or /, no trailing slash. Identical to
 * @corenel/protocol's normalizeFilePath, so a path means the same on every host. */
export function normalizeWorkspacePath(p: string): string {
  let n = (p || '').replace(/\\/g, '/').trim()
  if (n.startsWith('./')) n = n.slice(2)
  while (n.startsWith('/')) n = n.slice(1)
  if (n.length > 1 && n.endsWith('/')) n = n.slice(0, -1)
  return n
}

/**
 * Resolve a workflow file reference to a workspace path. References are relative
 * to the .pdflow's OWN directory, not the workspace root:
 *   "../prompts/x.prmd"  (parent-relative)  -> sibling folder of the flow's dir
 *   "./sub/x.prmd" / "sub/x.prmd" (sibling)  -> under the flow's dir
 *   "/prompts/x.prmd"   (root-absolute)      -> workspace root
 * Backslashes are tolerated. With no flowPath the reference is returned as-is.
 * A result starting with "../" escapes the workspace; callers treat it as missing.
 */
export function resolveFlowFileRef(flowPath: string | null | undefined, rawPath: string): string {
  const ref = rawPath.replace(/\\/g, '/')
  const dir = flowPath ? dirnamePosix(normalizeWorkspacePath(flowPath)) : ''
  return normalizeWorkspacePath(dir ? resolvePosix(dir, ref) : ref)
}

/**
 * Inverse of resolveFlowFileRef: a workspace path as a reference relative to the
 * .pdflow's directory. Round-trips: resolveFlowFileRef(flow, relativizeFlowRef(flow, p)) === p.
 */
export function relativizeFlowRef(flowPath: string | null | undefined, workspacePath: string): string {
  const target = normalizeWorkspacePath(workspacePath)
  const fromDir = flowPath ? dirnamePosix(normalizeWorkspacePath(flowPath)) : ''
  if (!fromDir || fromDir === '.') return target
  const from = fromDir.split('/').filter(Boolean)
  const to = target.split('/').filter(Boolean)
  let i = 0
  while (i < from.length && i < to.length && from[i] === to[i]) i++
  const rel = [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/')
  return rel || target
}
