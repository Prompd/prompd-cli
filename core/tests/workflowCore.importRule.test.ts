/// <reference types="node" />
/* Spec 2026-10-11 section 4.4: the workflow engine, tracer and packager must
 * never import a Node built-in or @corenel, directly or through any core module
 * they import. Walks relative imports transitively from both folders. */
import * as fs from 'fs'
import * as path from 'path'

const SRC = path.join(__dirname, '..', 'src')
const BANNED = /^(node:.*|fs|fs\/.*|path|path\/.*|vm|child_process|os|@corenel(\/.*)?)$/

function specifiers(source: string): string[] {
  const out: string[] = []
  const patterns = [
    /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|[\s;(=])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /(?:^|[\s;])import\s*['"]([^'"]+)['"]/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(source)) !== null) out.push(m[1])
  }
  return out
}

function listTs(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listTs(p))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

function resolveRelative(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function bannedImportsUnder(relRoot: string): string[] {
  const queue = listTs(path.join(SRC, relRoot))
  const seen = new Set<string>()
  const bad: string[] = []
  while (queue.length) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    for (const spec of specifiers(fs.readFileSync(file, 'utf8'))) {
      if (BANNED.test(spec)) bad.push(`${path.relative(SRC, file)} -> ${spec}`)
      else if (spec.startsWith('.')) {
        const next = resolveRelative(file, spec)
        if (next) queue.push(next)
      }
    }
  }
  return bad
}

describe('core workflow import rule', () => {
  it('the checker catches each banned form', () => {
    const src = "import * as fs from 'fs'\nimport { x } from '@corenel/harness'\nconst p = require('node:path')\nimport('child_process')\nimport 'os'"
    expect(specifiers(src).filter((s) => BANNED.test(s)).sort()).toEqual(['@corenel/harness', 'child_process', 'fs', 'node:path', 'os'])
  })

  it('workflowRun imports no Node built-in and no @corenel, directly or transitively', () => {
    expect(bannedImportsUnder('lib/workflowRun')).toEqual([])
  })

  it('workflowPackage imports no Node built-in and no @corenel, directly or transitively', () => {
    expect(bannedImportsUnder('lib/workflowPackage')).toEqual([])
  })
})
