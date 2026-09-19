/**
 * Parallel branch execution shared by every Prompd workflow engine (CLI + browser).
 *
 * runBranches schedules N branches under a wait policy and a concurrency limit,
 * aborts the branches that lose, and reports each branch's outcome in BRANCH
 * order. It knows nothing about nodes: the caller supplies how one branch runs.
 * traceForkBranches/forkJoinId derive fork-mode branches from a workflow's edges.
 */
import type { WorkflowFile, ParallelNodeData } from './workflowTypes'

export type BranchWaitFor = 'all' | 'any' | 'race' | 'quorum'
export type BranchMergeStrategy = 'object' | 'array' | 'first'
export type BranchStatus = 'ok' | 'error' | 'cancelled' | 'timeout'

export interface BranchSpec {
  /** Stable key used by the `object` merge strategy. */
  key: string
  label: string
  /** Node ids in execution order. Empty for a branch that passes input straight to the join. */
  nodeIds: string[]
}

export interface BranchResult<T = unknown> {
  key: string
  label: string
  status: BranchStatus
  output?: T
  error?: string
  ms: number
}

export interface RunBranchesOptions {
  waitFor: BranchWaitFor
  /** Successes required for `quorum` (clamped to 1..branches.length). */
  quorumCount?: number
  /** Branches running at once (default DEFAULT_MAX_CONCURRENCY, minimum 1). */
  maxConcurrency?: number
  /** Per-branch timeout in ms; unset or <= 0 means none. */
  timeoutMs?: number
  /** Aborting it cancels every unfinished branch and resolves with ok: false. */
  signal?: AbortSignal
  now?: () => number
}

export interface RunBranchesOutcome<T = unknown> {
  ok: boolean
  /** One entry per branch, in branch order. */
  results: BranchResult<T>[]
  /** The results the wait policy chose (see runBranches). */
  selected: BranchResult<T>[]
  error?: string
}

export type BranchRunner<T> = (branch: BranchSpec, signal: AbortSignal) => Promise<T>

export const DEFAULT_MAX_CONCURRENCY = 4

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Run branches concurrently and settle by `waitFor`:
 *  - all:    every branch settles; ok unless all failed; selected = all results.
 *  - race:   the first branch to settle (ok or not) decides; selected = [it].
 *  - any:    the first success decides; fails once all failed; selected = [it] | [].
 *  - quorum: quorumCount successes decide; fails once unreachable; selected = those, branch order.
 * Resolves as soon as the decision is made: losers are aborted, never awaited,
 * and anything they return later is ignored.
 */
export function runBranches<T>(
  branches: BranchSpec[],
  run: BranchRunner<T>,
  opts: RunBranchesOptions,
): Promise<RunBranchesOutcome<T>> {
  const n = branches.length
  if (n === 0) return Promise.resolve({ ok: true, results: [], selected: [] })
  const now = opts.now ?? (() => Date.now())
  const need = opts.waitFor === 'quorum'
    ? Math.max(1, Math.min(n, Math.floor(opts.quorumCount ?? 1)))
    : opts.waitFor === 'all' ? n : 1
  const limit = Math.max(1, Math.floor(opts.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY))
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 0

  const results: Array<BranchResult<T> | undefined> = new Array(n)
  const controllers: Array<AbortController | undefined> = new Array(n)
  const timers: Array<ReturnType<typeof setTimeout> | undefined> = new Array(n)
  const startedAt: number[] = new Array(n).fill(0)
  const order: number[] = []

  return new Promise((resolve) => {
    let nextIdx = 0
    let running = 0
    let okCount = 0
    let failCount = 0
    let done = false

    const finish = (ok: boolean, error?: string): void => {
      if (done) return
      done = true
      opts.signal?.removeEventListener('abort', onParentAbort)
      const t = now()
      for (let i = 0; i < n; i++) {
        if (timers[i]) clearTimeout(timers[i])
        if (results[i]) continue
        controllers[i]?.abort()
        results[i] = { key: branches[i].key, label: branches[i].label, status: 'cancelled', ms: controllers[i] ? t - startedAt[i] : 0 }
      }
      const all = results as BranchResult<T>[]
      let selected: BranchResult<T>[]
      if (opts.waitFor === 'all') selected = all
      else if (opts.waitFor === 'race') selected = order.length ? [all[order[0]]] : []
      else if (opts.waitFor === 'any') {
        const i = order.find((k) => all[k].status === 'ok')
        selected = i === undefined ? [] : [all[i]]
      } else selected = ok ? all.filter((r) => r.status === 'ok') : []
      resolve({ ok, results: all, selected, ...(error ? { error } : {}) })
    }

    const onParentAbort = (): void => finish(false, 'Aborted')

    const decide = (): void => {
      if (opts.waitFor === 'race') {
        const w = results[order[0]] as BranchResult<T>
        finish(w.status === 'ok', w.status === 'ok' ? undefined : `First branch to finish (${w.label}) ended with ${w.status}${w.error ? `: ${w.error}` : ''}`)
        return
      }
      if (opts.waitFor === 'all') {
        if (order.length === n) finish(okCount > 0, okCount > 0 ? undefined : 'All branches failed')
        return
      }
      if (okCount >= need) finish(true)
      else if (failCount > n - need) {
        finish(false, opts.waitFor === 'any' ? 'All branches failed' : `Quorum not reached: ${okCount} of ${need} required branches succeeded`)
      }
    }

    const settle = (i: number, part: { status: BranchStatus; output?: T; error?: string }): void => {
      if (done || results[i]) return
      if (timers[i]) clearTimeout(timers[i])
      results[i] = { key: branches[i].key, label: branches[i].label, ...part, ms: now() - startedAt[i] }
      running--
      order.push(i)
      if (part.status === 'ok') okCount++
      else failCount++
      decide()
      pump()
    }

    const start = (i: number): void => {
      const ac = new AbortController()
      controllers[i] = ac
      startedAt[i] = now()
      running++
      if (timeoutMs) {
        timers[i] = setTimeout(() => {
          ac.abort()
          settle(i, { status: 'timeout', error: `timed out after ${timeoutMs}ms` })
        }, timeoutMs)
      }
      let p: Promise<T>
      try { p = run(branches[i], ac.signal) } catch (e) { p = Promise.reject(e) }
      p.then(
        (output) => settle(i, { status: 'ok', output }),
        (e: unknown) => settle(i, { status: 'error', error: errMsg(e) }),
      )
    }

    function pump(): void {
      while (!done && running < limit && nextIdx < n) start(nextIdx++)
    }

    if (opts.signal?.aborted) { finish(false, 'Aborted'); return }
    opts.signal?.addEventListener('abort', onParentAbort, { once: true })
    pump()
  })
}

/** Combine the selected results. Shapes match the CLI engine's historical output. */
export function mergeBranchResults<T>(outcome: RunBranchesOutcome<T>, strategy: BranchMergeStrategy): unknown {
  const sel = outcome.selected
  if (strategy === 'object') {
    const merged: Record<string, unknown> = {}
    for (const r of sel) merged[r.key] = r.status === 'ok' ? r.output : null
    return merged
  }
  if (strategy === 'first') {
    const first = sel.find((r) => r.status === 'ok')
    return first ? { result: first.output } : { error: 'All branches failed' }
  }
  return sel.map((r) => (r.status === 'ok' ? r.output : null))
}

/** Edge handles that carry events, not execution flow. */
const EVENT_HANDLES = ['onError', 'onCheckpoint', 'onProgress', 'toolResult']

const forkIndex = (handle: string | undefined): number => {
  const k = parseInt((handle ?? '').replace('fork-', ''), 10)
  return Number.isFinite(k) ? k : 0
}

/**
 * Fork-mode branches of a parallel node, derived from edges: each `fork-<i>`
 * out-edge starts branch i, which follows execution edges forward until a
 * `merge` node or an edge into an `input-<i>` join handle. Labels come from
 * data.forkLabels (default "Branch N"); duplicates are suffixed so every key is unique.
 */
export function traceForkBranches(file: WorkflowFile, parallelId: string): BranchSpec[] {
  const node = file.nodes.find((n) => n.id === parallelId)
  if (!node || node.type !== 'parallel') return []
  const data = node.data as ParallelNodeData
  const mergeIds = new Set(file.nodes.filter((n) => n.type === 'merge').map((n) => n.id))
  const forkEdges = file.edges
    .filter((e) => e.source === parallelId && e.sourceHandle?.startsWith('fork-'))
    .sort((a, b) => forkIndex(a.sourceHandle) - forkIndex(b.sourceHandle))
  const labelUses = new Map<string, number>()

  return forkEdges.map((fe) => {
    const idx = forkIndex(fe.sourceHandle)
    const nodeIds: string[] = []
    if (!fe.targetHandle?.startsWith('input-')) {
      const visited = new Set<string>()
      const queue = [fe.target]
      while (queue.length > 0) {
        const id = queue.shift() as string
        if (visited.has(id) || mergeIds.has(id)) continue
        visited.add(id)
        nodeIds.push(id)
        for (const e of file.edges) {
          if (e.source !== id) continue
          if (e.sourceHandle === 'loop-end' || e.sourceHandle === 'parallel-end') continue
          if (e.targetHandle?.startsWith('fork-')) continue
          if (e.sourceHandle && EVENT_HANDLES.includes(e.sourceHandle)) continue
          if (e.targetHandle?.startsWith('input-')) continue
          if (!visited.has(e.target) && !mergeIds.has(e.target)) queue.push(e.target)
        }
      }
    }
    const base = data.forkLabels?.[idx]?.trim() || `Branch ${idx + 1}`
    const uses = labelUses.get(base) ?? 0
    labelUses.set(base, uses + 1)
    const label = uses === 0 ? base : `${base} (${uses + 1})`
    return { key: label, label, nodeIds }
  })
}

/** The node a fork-mode parallel's branches rejoin at (target of an `input-*` edge). */
export function forkJoinId(file: WorkflowFile, parallelId: string): string | undefined {
  const members = new Set<string>([parallelId, ...traceForkBranches(file, parallelId).flatMap((b) => b.nodeIds)])
  return file.edges.find((e) => members.has(e.source) && e.targetHandle?.startsWith('input-'))?.target
}
