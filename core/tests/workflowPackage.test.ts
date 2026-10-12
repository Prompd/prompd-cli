/* Workflow packaging: the reference walk, the tracer over an async reader, the
 * secret scan, and the .pdpkg writer (round trip through core's ingest). */
import {
  traceWorkflowFiles, workflowNodeRefs, prmdFileRefs, scanForSecrets, buildWorkflowPackage,
  packagePathError, extractPdpkg, type WorkflowPackageManifest,
} from '../src/index'

function memReader(files: Record<string, string>): { reads: string[]; read: (p: string) => Promise<string | null> } {
  const reads: string[] = []
  return {
    reads,
    read: async (p: string) => {
      reads.push(p)
      return Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null
    },
  }
}

const pdflow = (nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>): string =>
  JSON.stringify({ version: '1.0', metadata: { id: 'f', name: 'f' }, nodes: nodes.map((n) => ({ ...n, position: { x: 0, y: 0 } })), edges: [] })

const WORKSPACE: Record<string, string> = {
  'flows/main.pdflow': pdflow([
    { id: 't', type: 'trigger', data: { label: 't' } },
    { id: 'p', type: 'prompt', data: { label: 'p', source: '../prompts/a.prmd' } },
    { id: 'r', type: 'prompt', data: { label: 'r', sourceType: 'raw', source: 'inline text' } },
    { id: 'k', type: 'prompt', data: { label: 'k', source: '@acme/tools/x.prmd' } },
    { id: 'g', type: 'guardrail', data: { label: 'g', systemPromptSource: 'file', systemPromptFile: 'checks/pii.prmd' } },
    { id: 'w', type: 'workflow', data: { label: 'w', workflowPath: 'sub.pdflow' } },
  ]),
  'flows/sub.pdflow': pdflow([{ id: 's', type: 'prompt', data: { label: 's', source: './s.prmd' } }]),
  'flows/s.prmd': '---\nid: s\nname: s\nversion: 1.0.0\n---\nSub prompt.',
  'flows/checks/pii.prmd': '---\nid: pii\nname: pii\nversion: 1.0.0\n---\nFind names.',
  'prompts/a.prmd': '---\nid: a\nname: a\nversion: 1.0.0\ninherits: ./base.prmd\ncontext: ../ctx/notes.md\n---\n{% include "./parts/intro.md" %}\nBody.',
  'prompts/base.prmd': '---\nid: base\nname: base\nversion: 1.0.0\n---\n{% include "a.prmd" %}',
  'prompts/parts/intro.md': 'Intro.',
}

describe('workflowNodeRefs', () => {
  it('collects prompt sources, sub-workflows and file-backed system prompts; @ refs are package refs', () => {
    const file = JSON.parse(WORKSPACE['flows/main.pdflow']) as unknown
    expect(workflowNodeRefs(file)).toEqual({
      files: ['../prompts/a.prmd', 'checks/pii.prmd', 'sub.pdflow'],
      packageRefs: ['@acme/tools/x.prmd'],
    })
  })
  it('tolerates junk', () => {
    expect(workflowNodeRefs(null)).toEqual({ files: [], packageRefs: [] })
    expect(workflowNodeRefs({ nodes: [null, 3, { type: 'prompt', data: { source: 7 } }] })).toEqual({ files: [], packageRefs: [] })
  })
})

describe('prmdFileRefs', () => {
  it('reads sections, context, override, inherits and includes', () => {
    const text = '---\nid: x\nname: x\nversion: 1.0.0\nsystem: ./sys.md\ncontexts:\n  - ./c1.md\n  - not-a-path\noverride:\n  task: ../t.md\ninherits: "@scope/pkg@1.0.0/base.prmd"\n---\n{% include \'part.md\' %}'
    expect(prmdFileRefs(text)).toEqual({
      files: ['./sys.md', './c1.md', '../t.md', './part.md'],
      packageRefs: ['@scope/pkg@1.0.0/base.prmd'],
    })
  })
  const fmOnly = (fm: string): string => `---\nid: x\nname: x\nversion: 1.0.0\n${fm}\n---\nBody.`
  it.each([
    ['a string', 'using: "@acme/a@1.0.0"', ['@acme/a@1.0.0']],
    ['an array of strings', 'using:\n  - "@acme/a@1.0.0"\n  - "@acme/b@2.0.0"', ['@acme/a@1.0.0', '@acme/b@2.0.0']],
    ['an array of {name, prefix}', 'using:\n  - name: "@acme/a@1.0.0"\n    prefix: "@a"', ['@acme/a@1.0.0']],
    ['an array of {package, prefix}', 'using:\n  - package: "@acme/b@1.0.0"\n    prefix: "@b"', ['@acme/b@1.0.0']],
    ['an object map of prefixes', 'using:\n  "@acme/c@1.0.0": "@c"\n  "@acme/d@2.0.0":\n    prefix: "@d"', ['@acme/c@1.0.0', '@acme/d@2.0.0']],
  ])('using as %s is a package ref', (_n, fm, refs) => {
    expect(prmdFileRefs(fmOnly(fm))).toEqual({ files: [], packageRefs: refs })
  })
  it('@-prefixed section, context and override values are package refs, not dropped', () => {
    const text = fmOnly('system: "@acme/sys@1.0.0/s.md"\ncontext: "@acme/ctx@1.0.0/notes.md"\noverride:\n  task: "@acme/t@1.0.0/t.md"')
    expect(prmdFileRefs(text)).toEqual({
      files: [],
      packageRefs: ['@acme/sys@1.0.0/s.md', '@acme/ctx@1.0.0/notes.md', '@acme/t@1.0.0/t.md'],
    })
  })
  it('a file without frontmatter has no refs', () => {
    expect(prmdFileRefs('just text {% include "x.md" %}')).toEqual({ files: [], packageRefs: [] })
  })
})

describe('traceWorkflowFiles', () => {
  it('walks the flow, sub-workflows and prompt dependencies; reports missing and package refs', async () => {
    const r = memReader(WORKSPACE)
    expect(await traceWorkflowFiles(r.read, 'flows/main.pdflow')).toEqual({
      files: [
        'flows/checks/pii.prmd', 'flows/main.pdflow', 'flows/s.prmd', 'flows/sub.pdflow',
        'prompts/a.prmd', 'prompts/base.prmd', 'prompts/parts/intro.md',
      ],
      missing: ['ctx/notes.md'],
      packageRefs: ['@acme/tools/x.prmd'],
    })
  })

  it('an include cycle terminates and reads each file once', async () => {
    const r = memReader(WORKSPACE)
    await traceWorkflowFiles(r.read, 'flows/main.pdflow')
    expect(r.reads.filter((p) => p === 'prompts/a.prmd')).toHaveLength(1)
    expect(r.reads.filter((p) => p === 'prompts/base.prmd')).toHaveLength(1)
  })

  it('a ref that escapes the workspace is missing and never read', async () => {
    const r = memReader({ 'main.pdflow': pdflow([{ id: 'p', type: 'prompt', data: { label: 'p', source: '../outside.prmd' } }]) })
    const t = await traceWorkflowFiles(r.read, 'main.pdflow')
    expect(t.missing).toEqual(['../outside.prmd'])
    expect(r.reads.some((p) => p.startsWith('../'))).toBe(false)
  })

  it('a missing entry is reported missing', async () => {
    const t = await traceWorkflowFiles(memReader({}).read, 'nope.pdflow')
    expect(t).toEqual({ files: [], missing: ['nope.pdflow'], packageRefs: [] })
  })

  it('a reader that throws counts as missing', async () => {
    const t = await traceWorkflowFiles(async () => { throw new Error('EACCES') }, 'x.prmd')
    expect(t.missing).toEqual(['x.prmd'])
  })

  it('a .prmd that depends on a package through using: reports it in packageRefs', async () => {
    const r = memReader({
      'main.pdflow': pdflow([{ id: 'p', type: 'prompt', data: { label: 'p', source: './u.prmd' } }]),
      'u.prmd': '---\nid: u\nname: u\nversion: 1.0.0\nusing:\n  - name: "@acme/lib@1.2.0"\n    prefix: "@lib"\n---\nBody.',
    })
    const t = await traceWorkflowFiles(r.read, 'main.pdflow')
    expect(t.files).toEqual(['main.pdflow', 'u.prmd'])
    expect(t.packageRefs).toEqual(['@acme/lib@1.2.0'])
  })

  it('starts from a .prmd too (the CLI packager uses this)', async () => {
    const t = await traceWorkflowFiles(memReader(WORKSPACE).read, 'prompts/a.prmd')
    expect(t.files).toEqual(['prompts/a.prmd', 'prompts/base.prmd', 'prompts/parts/intro.md'])
    expect(t.missing).toEqual(['ctx/notes.md'])
  })
})

describe('scanForSecrets', () => {
  it('names the file, line and kind, and masks the match', () => {
    expect(scanForSecrets('p.prmd', 'hello\nkey: sk-abcdefghijklmnopqrstuvwxyz\n')).toEqual([
      { path: 'p.prmd', line: 2, type: 'OpenAI API Key', match: 'sk-abcde...' },
    ])
  })
  it('finds a private key header and is quiet on clean text', () => {
    expect(scanForSecrets('k.md', '-----BEGIN PRIVATE KEY-----')[0].type).toBe('Private Key Header')
    expect(scanForSecrets('c.md', 'no secrets here')).toEqual([])
  })
})

describe('buildWorkflowPackage', () => {
  const manifest: WorkflowPackageManifest = { name: 'weekly', version: '1.0.0', type: 'workflow', main: 'flows/main.pdflow' }

  it('round-trips through core ingest with a prompd.json manifest', async () => {
    const bytes = await buildWorkflowPackage(
      [{ path: 'prompts/a.prmd', text: 'A' }, { path: 'flows/main.pdflow', text: '{}' }],
      manifest,
    )
    const files = await extractPdpkg(bytes)
    expect(files.get('prompts/a.prmd')).toBe('A')
    expect(files.get('flows/main.pdflow')).toBe('{}')
    expect(JSON.parse(files.get('prompd.json') ?? '')).toEqual({ ...manifest, files: ['flows/main.pdflow', 'prompts/a.prmd'] })
  })

  it.each([
    ['../x.prmd', /has a \.\. segment/],
    ['a/../../x.prmd', /has a \.\. segment/],
    ['/abs.prmd', /is absolute/],
    ['C:/x.prmd', /is absolute/],
    ['a\\b.prmd', /backslashes/],
    ['prompd.json', /reserved/],
    ['manifest.json', /reserved/],
    ['', /empty path/],
  ])('refuses the path %s', async (p, why) => {
    await expect(buildWorkflowPackage([{ path: p, text: 'x' }, { path: 'flows/main.pdflow', text: '{}' }], manifest)).rejects.toThrow(why)
  })

  it('refuses a main that is not packaged, and duplicates', async () => {
    await expect(buildWorkflowPackage([{ path: 'a.prmd', text: 'x' }], manifest)).rejects.toThrow(/not one of the packaged files/)
    await expect(buildWorkflowPackage([{ path: 'flows/main.pdflow', text: '{}' }, { path: 'flows/main.pdflow', text: '{}' }], manifest))
      .rejects.toThrow(/Duplicate/)
  })

  it('packagePathError accepts a normal relative path', () => {
    expect(packagePathError('flows/sub/x.prmd')).toBeNull()
  })
})

describe('traceWorkflowFiles containment', () => {
  const prmdWith = (fm: string, body = ''): string => `---\nid: x\nname: x\nversion: 1.0.0\n${fm}\n---\n${body}`

  it.each([
    ['a drive path in an include', 'root.prmd', prmdWith('', '{% include "C:/x.md" %}'), 'C:/x.md'],
    ['a drive path in inherits', 'root.prmd', prmdWith('inherits: D:/secret.prmd'), 'D:/secret.prmd'],
    ['./C:/ from a root-level prmd', 'root.prmd', prmdWith('context: ./C:/x.md'), 'C:/x.md'],
    ['../C:/ from sub/', 'sub/a.prmd', prmdWith('context: ../C:/x.md'), 'C:/x.md'],
  ])('%s is missing and never read', async (_n, entry, text, bad) => {
    const r = memReader({ [entry]: text })
    const t = await traceWorkflowFiles(r.read, entry)
    expect(t.missing).toEqual([bad])
    expect(r.reads).toEqual([entry])
  })

  it('an entry that climbs out via a/../../ is missing and never read', async () => {
    const r = memReader({})
    const t = await traceWorkflowFiles(r.read, 'a/../../x.pdflow')
    expect(t.missing).toEqual(['../x.pdflow'])
    expect(r.reads).toEqual([])
  })

  it('a normal ../sibling.prmd from sub/ is still read', async () => {
    const r = memReader({
      'sub/a.prmd': prmdWith('context: ../sibling.prmd'),
      'sibling.prmd': prmdWith(''),
    })
    const t = await traceWorkflowFiles(r.read, 'sub/a.prmd')
    expect(t.files).toEqual(['sibling.prmd', 'sub/a.prmd'])
    expect(t.missing).toEqual([])
    expect(r.reads).toContain('sibling.prmd')
  })
})
