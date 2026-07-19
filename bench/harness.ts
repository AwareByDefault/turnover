// A tiny, dependency-free benchmark harness. The framework takes no runtime
// deps and only a couple of dev deps, so the benchmarks stay self-contained:
// high-resolution timing via `Bun.nanoseconds()`, memory via a forced GC
// (`Bun.gc(true)`) plus the live JSC heap size (`bun:jsc`), and a plain-text
// report. (`process.memoryUsage().heapUsed` is too coarse for these deltas.)

import { heapStats } from 'bun:jsc'

/** One measured line in a report section. */
export interface MetricRow {
  label: string
  value: string
  note?: string
}

/** A titled block of metrics — each benchmark returns one. */
export interface Section {
  title: string
  rows: MetricRow[]
}

/** Iteration counts for a timed measurement. */
export interface TimeOptions {
  /** Untimed calls to reach steady state before measuring. */
  warmup?: number
  /** Number of measured rounds (each round is `batch` calls). */
  rounds?: number
  /** Calls per round; keep a round in the millisecond range for stable timing. */
  batch?: number
}

/** Timing statistics for an operation, in nanoseconds per call. */
export interface TimingStats {
  opsPerSec: number
  meanNs: number
  p50Ns: number
  p99Ns: number
  minNs: number
  rounds: number
}

/**
 * Time an operation. `fn` may be sync or async; every call is awaited, so an
 * async `fn` measures sequential (single-flight) throughput. Timing is batched
 * — each round runs `batch` calls and divides — which is far more stable than
 * timing individual sub-microsecond calls.
 */
export async function time(
  fn: () => unknown | Promise<unknown>,
  options: TimeOptions = {},
): Promise<TimingStats> {
  const warmup = options.warmup ?? 100
  const rounds = options.rounds ?? 25
  const batch = options.batch ?? 1000

  for (let i = 0; i < warmup; i++) await fn()

  const perOp: number[] = []
  for (let r = 0; r < rounds; r++) {
    const start = Bun.nanoseconds()
    for (let i = 0; i < batch; i++) await fn()
    perOp.push((Bun.nanoseconds() - start) / batch)
  }

  perOp.sort((a, b) => a - b)
  const mean = perOp.reduce((sum, n) => sum + n, 0) / perOp.length
  const at = (q: number) =>
    perOp[Math.min(perOp.length - 1, Math.floor(perOp.length * q))] ?? 0
  return {
    opsPerSec: 1e9 / mean,
    meanNs: mean,
    p50Ns: at(0.5),
    p99Ns: at(0.99),
    minNs: perOp[0] ?? 0,
    rounds,
  }
}

/** Force a full GC and return the live JSC heap size in bytes. */
export function heapUsed(): number {
  Bun.gc(true)
  return heapStats().heapSize
}

/** Resident set size (whole-process memory) in bytes, after a full GC. */
export function residentSize(): number {
  Bun.gc(true)
  return process.memoryUsage().rss
}

/** Turn a timing result into a report row (`ops/s`, with mean + p99 as a note). */
export function timingRow(label: string, stats: TimingStats): MetricRow {
  return {
    label,
    value: `${formatCount(stats.opsPerSec)} ops/s`,
    note: `${formatDuration(stats.meanNs)}/op · p99 ${formatDuration(stats.p99Ns)}`,
  }
}

export function formatCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toFixed(0)
}

export function formatDuration(ns: number): string {
  if (ns < 1_000) return `${ns.toFixed(0)} ns`
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} µs`
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`
  return `${(ns / 1_000_000_000).toFixed(2)} s`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toFixed(bytes < 100 ? 1 : 0)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** Print a section as an aligned two-column table. */
export function printSection(section: Section): void {
  const labelWidth = Math.max(...section.rows.map((r) => r.label.length))
  const valueWidth = Math.max(...section.rows.map((r) => r.value.length))
  console.log(`\n${section.title}`)
  console.log('─'.repeat(section.title.length))
  for (const row of section.rows) {
    const note = row.note ? `   ${row.note}` : ''
    console.log(
      `  ${row.label.padEnd(labelWidth)}   ${row.value.padStart(valueWidth)}${note}`,
    )
  }
}
