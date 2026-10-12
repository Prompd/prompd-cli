/* Write a workflow .pdpkg: the traced files at their workspace-relative paths
 * plus a prompd.json manifest (type 'workflow', main = the .pdflow). JSZip runs
 * in the browser and in Node; reading it back is core's extractPdpkg. */
import JSZip from 'jszip'

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
  // Core's package reader prefers manifest.json over prompd.json, so a packaged
  // manifest.json would replace this package's manifest on ingest.
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
  const zip = new JSZip()
  zip.file('prompd.json', JSON.stringify({ ...manifest, files: paths }, null, 2))
  const byPath = new Map(files.map((f) => [f.path, f.text]))
  for (const p of paths) zip.file(p, byPath.get(p) as string)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
