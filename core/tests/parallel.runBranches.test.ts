import { runBranches, mergeBranchResults, type BranchSpec, type BranchRunner } from '../src/lib/parallel'

const specs = (...labels: string[]): BranchSpec[] => labels.map((l) => ({ key: l, label: l, nodeIds: [] }))

/** A controllable branch: resolve/reject it from the test, and see whether it was aborted. */
interface Ctl { resolve: (v: string) => void; reject: (e: Error) => void; aborted: () => boolean; started: boolean }
function controlled(labels: string[]): { ctl: Record<string, Ctl>; run: BranchRunner<string> } {
  const ctl: Record<string, Ctl> = {}
  for (const l of labels) ctl[l] = { resolve: () => undefined, reject: () => undefined, aborted: () => false, started: false }
  const run: BranchRunner<string> = (b, signal) => new Promise<string>((resolve, reject) => {
    const c = ctl[b.label]
    c.started = true
    c.resolve = resolve
    c.reject = reject
    c.aborted = () => signal.aborted
  })
  return { ctl, run }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('runBranches', () => {
  it('all: waits for every branch, keeps branch order, a failure does not fail the node', async () => {
    const { ctl, run } = controlled(['a', 'b', 'c'])
    const p = runBranches(specs('a', 'b', 'c'), run, { waitFor: 'all' })
    await tick()
    ctl.c.resolve('C'); ctl.a.reject(new Error('boom')); ctl.b.resolve('B')
    const out = await p
    expect(out.ok).toBe(true)
    expect(out.results.map((r) => [r.label, r.status])).toEqual([['a', 'error'], ['b', 'ok'], ['c', 'ok']])
    expect(out.results[0].error).toBe('boom')
    expect(out.selected).toHaveLength(3)
  })

  it('all: fails only when every branch fails', async () => {
    const { ctl, run } = controlled(['a', 'b'])
    const p = runBranches(specs('a', 'b'), run, { waitFor: 'all' })
    await tick()
    ctl.a.reject(new Error('x')); ctl.b.reject(new Error('y'))
    const out = await p
    expect(out.ok).toBe(false)
    expect(out.error).toBe('All branches failed')
  })

  it('race: the first to settle wins even if it failed, and the rest are aborted', async () => {
    const { ctl, run } = controlled(['a', 'b'])
    const p = runBranches(specs('a', 'b'), run, { waitFor: 'race' })
    await tick()
    ctl.b.reject(new Error('fast fail'))
    const out = await p
    expect(out.ok).toBe(false)
    expect(out.selected.map((r) => r.label)).toEqual(['b'])
    expect(out.results[0].status).toBe('cancelled')
    expect(ctl.a.aborted()).toBe(true)
  })

  it('race: a successful first finisher wins', async () => {
    const { ctl, run } = controlled(['a', 'b'])
    const p = runBranches(specs('a', 'b'), run, { waitFor: 'race' })
    await tick()
    ctl.b.resolve('B')
    const out = await p
    expect(out.ok).toBe(true)
    expect(out.selected.map((r) => [r.label, r.output])).toEqual([['b', 'B']])
  })

  it('any: returns on the first success without waiting for slower branches', async () => {
    const { ctl, run } = controlled(['a', 'b', 'c'])
    const p = runBranches(specs('a', 'b', 'c'), run, { waitFor: 'any' })
    await tick()
    ctl.a.reject(new Error('nope'))
    ctl.c.resolve('C')
    const out = await p // b never settles; this must still resolve
    expect(out.ok).toBe(true)
    expect(out.selected.map((r) => [r.label, r.output])).toEqual([['c', 'C']])
    expect(out.results.map((r) => r.status)).toEqual(['error', 'cancelled', 'ok'])
    expect(ctl.b.aborted()).toBe(true)
  })

  it('any: fails once every branch has failed', async () => {
    const { ctl, run } = controlled(['a', 'b'])
    const p = runBranches(specs('a', 'b'), run, { waitFor: 'any' })
    await tick()
    ctl.a.reject(new Error('1')); ctl.b.reject(new Error('2'))
    const out = await p
    expect(out.ok).toBe(false)
    expect(out.selected).toEqual([])
    expect(out.error).toBe('All branches failed')
  })

  it('quorum: done at k successes, selected in branch order, rest aborted', async () => {
    const { ctl, run } = controlled(['a', 'b', 'c', 'd'])
    const p = runBranches(specs('a', 'b', 'c', 'd'), run, { waitFor: 'quorum', quorumCount: 2 })
    await tick()
    ctl.d.resolve('D'); ctl.b.resolve('B')
    const out = await p
    expect(out.ok).toBe(true)
    expect(out.selected.map((r) => r.label)).toEqual(['b', 'd'])
    expect(ctl.a.aborted()).toBe(true)
    expect(ctl.c.aborted()).toBe(true)
  })

  it('quorum: fails as soon as the quorum is unreachable', async () => {
    const { ctl, run } = controlled(['a', 'b', 'c'])
    const p = runBranches(specs('a', 'b', 'c'), run, { waitFor: 'quorum', quorumCount: 2 })
    await tick()
    ctl.a.reject(new Error('1')); ctl.b.reject(new Error('2'))
    const out = await p
    expect(out.ok).toBe(false)
    expect(out.error).toBe('Quorum not reached: 0 of 2 required branches succeeded')
    expect(ctl.c.aborted()).toBe(true)
  })

  it('quorum: quorumCount is clamped to the branch count', async () => {
    const { ctl, run } = controlled(['a', 'b'])
    const p = runBranches(specs('a', 'b'), run, { waitFor: 'quorum', quorumCount: 9 })
    await tick()
    ctl.a.resolve('A'); ctl.b.resolve('B')
    const out = await p
    expect(out.ok).toBe(true)
    expect(out.selected).toHaveLength(2)
  })

  it('maxConcurrency: never runs more than the limit at once', async () => {
    const { ctl, run } = controlled(['a', 'b', 'c'])
    const p = runBranches(specs('a', 'b', 'c'), run, { waitFor: 'all', maxConcurrency: 2 })
    await tick()
    expect([ctl.a.started, ctl.b.started, ctl.c.started]).toEqual([true, true, false])
    ctl.a.resolve('A')
    await tick()
    expect(ctl.c.started).toBe(true)
    ctl.b.resolve('B'); ctl.c.resolve('C')
    expect((await p).ok).toBe(true)
  })

  it('race with a concurrency limit: unstarted branches are cancelled, never started', async () => {
    const { ctl, run } = controlled(['a', 'b', 'c'])
    const p = runBranches(specs('a', 'b', 'c'), run, { waitFor: 'race', maxConcurrency: 1 })
    await tick()
    ctl.a.resolve('A')
    const out = await p
    expect(out.results.map((r) => r.status)).toEqual(['ok', 'cancelled', 'cancelled'])
    expect(ctl.b.started).toBe(false)
    expect(out.results[1].ms).toBe(0)
  })

  it('timeoutMs: a slow branch becomes a timeout and is aborted', async () => {
    const { ctl, run } = controlled(['slow'])
    const out = await runBranches(specs('slow'), run, { waitFor: 'all', timeoutMs: 20 })
    expect(out.results[0].status).toBe('timeout')
    expect(out.results[0].error).toBe('timed out after 20ms')
    expect(ctl.slow.aborted()).toBe(true)
  })

  it('parent abort: resolves immediately with every unfinished branch cancelled', async () => {
    const { ctl, run } = controlled(['a', 'b'])
    const ac = new AbortController()
    const p = runBranches(specs('a', 'b'), run, { waitFor: 'all', signal: ac.signal })
    await tick()
    ctl.a.resolve('A')
    await tick()
    ac.abort()
    const out = await p
    expect(out.ok).toBe(false)
    expect(out.error).toBe('Aborted')
    expect(out.results.map((r) => r.status)).toEqual(['ok', 'cancelled'])
    expect(ctl.b.aborted()).toBe(true)
  })

  it('an already-aborted parent signal starts nothing', async () => {
    const { ctl, run } = controlled(['a'])
    const ac = new AbortController()
    ac.abort()
    const out = await runBranches(specs('a'), run, { waitFor: 'all', signal: ac.signal })
    expect(out).toMatchObject({ ok: false, error: 'Aborted' })
    expect(ctl.a.started).toBe(false)
  })

  it('a late result from an aborted branch is ignored', async () => {
    const { ctl, run } = controlled(['a', 'b'])
    const p = runBranches(specs('a', 'b'), run, { waitFor: 'race' })
    await tick()
    ctl.a.resolve('A')
    const out = await p
    ctl.b.resolve('late')
    await tick()
    expect(out.results[1].status).toBe('cancelled')
    expect(out.results[1].output).toBeUndefined()
  })

  it('a runner that throws synchronously counts as an error', async () => {
    const out = await runBranches(specs('a'), () => { throw new Error('sync') }, { waitFor: 'all' })
    expect(out.results[0]).toMatchObject({ status: 'error', error: 'sync' })
  })

  it('no branches: ok with empty results', async () => {
    const out = await runBranches([], async () => 'x', { waitFor: 'all' })
    expect(out).toEqual({ ok: true, results: [], selected: [] })
  })
})

describe('mergeBranchResults', () => {
  const outcome = {
    ok: true,
    results: [],
    selected: [
      { key: 'a', label: 'a', status: 'ok' as const, output: 'A', ms: 1 },
      { key: 'b', label: 'b', status: 'error' as const, error: 'x', ms: 1 },
    ],
  }
  it('object: keyed by branch key, failures are null', () => {
    expect(mergeBranchResults(outcome, 'object')).toEqual({ a: 'A', b: null })
  })
  it('array: branch order, failures are null', () => {
    expect(mergeBranchResults(outcome, 'array')).toEqual(['A', null])
  })
  it('first: first ok output wrapped as { result }', () => {
    expect(mergeBranchResults(outcome, 'first')).toEqual({ result: 'A' })
    expect(mergeBranchResults({ ok: false, results: [], selected: [] }, 'first')).toEqual({ error: 'All branches failed' })
  })
})
