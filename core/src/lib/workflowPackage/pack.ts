/* Write a workflow .pdpkg: the traced files at their workspace-relative paths
 * plus a prompd.json manifest (type 'workflow', main = the .pdflow), written
 * through packPdpkg so the package carries integrity. Reading it back is core's
 * extractPdpkg / openPdpkg. */
import { packPdpkg } from '../package/pack'

export interface WorkflowPackageFile {
  /** Workspace-relative posix path. */
  path: string
  text: string
}

export interface WorkflowPackageManifest {
  name: string
  version: string
  description?: string
  type: 'workflow'
  /** The .pdflow to run, one of the packaged paths. */
  main: string
}

/** Why `p` cannot be a package entry, or null when it can. */
export function packagePathError(p: string): string | null {
  if (!p) return 'empty path'
  if (p.includes('\0')) return 'contains a null byte'
  if (p.includes('\\')) return 'uses backslashes; package paths are posix'
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return 'is absolute'
  const segments = p.split('/')
  if (segments.some((s) => s === '..')) return 'has a .. segment'
  if (segments.some((s) => s === '' || s === '.')) return 'has an empty or . segment'
  // Core refuses a package that holds a root manifest.json, and prompd.json is
  // written by the packer.
  if (p === 'prompd.json' || p === 'manifest.json') return 'is reserved for the manifest'
  return null
}

export async function buildWorkflowPackage(
  files: readonly WorkflowPackageFile[],
  manifest: WorkflowPackageManifest,
): Promise<Uint8Array> {
  if (manifest.type !== 'workflow') throw new Error(`Package type must be "workflow", got "${String(manifest.type)}"`)
  if (!manifest.name.trim() || !manifest.version.trim()) throw new Error('Package name and version are required')
  const seen = new Set<string>()
  for (const f of files) {
    const err = packagePathError(f.path)
    if (err) throw new Error(`Refusing package path "${f.path}": ${err}`)
    if (seen.has(f.path)) throw new Error(`Duplicate package path "${f.path}"`)
    seen.add(f.path)
  }
  if (!seen.has(manifest.main)) throw new Error(`Package main "${manifest.main}" is not one of the packaged files`)
  if (!manifest.main.toLowerCase().endsWith('.pdflow')) throw new Error(`Package main "${manifest.main}" is not a .pdflow`)
  const paths = [...seen].sort()
  const byPath = new Map(files.map((f) => [f.path, f.text]))
  return packPdpkg(
    { ...manifest, files: paths },
    new Map(paths.map((p) => [p, byPath.get(p) as string])),
  )
}
