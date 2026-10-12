/// <reference types="node" />
/* Spec 2026-10-11 section 4.4: the workflow engine, tracer and packager must
 * never import a Node built-in or @corenel, directly or through any core module
 * they import. Walks relative imports transitively from both folders. */
import * as fs from 'fs'
import * as os from 'os'
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

/** The .ts file a relative specifier names: an extensionless path, a `.js`
 * specifier compiled from `.ts`, an explicit `.ts`, or a folder's index. Null
 * when none exists, which the walk treats as a failure, never a skip. */
function resolveRelative(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec)
  const candidates = [`${base}.ts`, path.join(base, 'index.ts')]
  if (base.endsWith('.js')) candidates.push(`${base.slice(0, -3)}.ts`)
  if (base.endsWith('.ts')) candidates.push(base)
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Every banned import and every relative import that does not resolve,
 * walking relative imports transitively from the .ts files under `root`.
 * Entries are `<file relative to base> -> <specifier>`. */
function importProblems(root: string, base: string): string[] {
  const queue = listTs(root)
  const seen = new Set<string>()
  const bad: string[] = []
  while (queue.length) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    const rel = path.relative(base, file).split(path.sep).join('/')
    for (const spec of specifiers(fs.readFileSync(file, 'utf8'))) {
      if (BANNED.test(spec)) bad.push(`${rel} -> ${spec}`)
      else if (spec.startsWith('.')) {
        const next = resolveRelative(file, spec)
        if (next) queue.push(next)
        else bad.push(`${rel} -> ${spec} (does not resolve)`)
      }
    }
  }
  return bad.sort()
}

const bannedImportsUnder = (relRoot: string): string[] => importProblems(path.join(SRC, relRoot), SRC)

describe('core workflow import rule', () => {
  it('the checker catches each banned form', () => {
    const src = "import * as fs from 'fs'\nimport { x } from '@corenel/harness'\nconst p = require('node:path')\nimport('child_process')\nimport 'os'"
    expect(specifiers(src).filter((s) => BANNED.test(s)).sort()).toEqual(['@corenel/harness', 'child_process', 'fs', 'node:path', 'os'])
  })

  it('the walk fails on a relative import that does not resolve, and follows .js, .ts and index forms', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-rule-'))
    try {
      // lib/ is the walked root; shared/ sits outside it, so its files are only
      // checked when the walk reaches them through an import that resolves.
      fs.mkdirSync(path.join(dir, 'lib'), { recursive: true })
      fs.mkdirSync(path.join(dir, 'shared', 'sub'), { recursive: true })
      const write = (rel: string, lines: string[]): void => fs.writeFileSync(path.join(dir, rel), lines.join('\n'))
      write('lib/a.ts', [
        "import { b } from '../shared/b.js'",
        "import { c } from '../shared/c.ts'",
        "import { s } from '../shared/sub'",
        "import { m } from './missing'",
      ])
      write('shared/b.ts', ["import * as fs from 'fs'", 'export const b = 1'])
      write('shared/c.ts', ["import * as os from 'os'", 'export const c = 1'])
      write('shared/sub/index.ts', ["export { z } from '../gone.js'"])
      expect(importProblems(path.join(dir, 'lib'), dir)).toEqual([
        'lib/a.ts -> ./missing (does not resolve)',
        'shared/b.ts -> fs',
        'shared/c.ts -> os',
        'shared/sub/index.ts -> ../gone.js (does not resolve)',
      ])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('workflowRun imports no Node built-in and no @corenel, directly or transitively', () => {
    expect(bannedImportsUnder('lib/workflowRun')).toEqual([])
  })

  it('workflowPackage imports no Node built-in and no @corenel, directly or transitively', () => {
    expect(bannedImportsUnder('lib/workflowPackage')).toEqual([])
  })
})
