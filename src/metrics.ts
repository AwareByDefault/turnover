import type { Plugin, RequestHook } from './app'
import type { Interceptor } from './http'

/** A set of label values keyed by label name. */
export type Labels = Record<string, string>

/** Default histogram buckets (seconds), matching common HTTP-latency defaults. */
export const DEFAULT_BUCKETS: readonly number[] = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
]

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')
}

/** Render a `{k="v",…}` label clause, or `""` when there are no labels. */
function renderLabels(labels: Labels, extra?: [string, string]): string {
  const pairs = Object.entries(labels)
  if (extra) pairs.push(extra)
  if (pairs.length === 0) return ''
  return `{${pairs.map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(',')}}`
}

/** Restrict a label bag to the declared names (missing → `""`) and key it. */
function pick(labelNames: readonly string[], labels: Labels): Labels {
  const out: Labels = {}
  for (const name of labelNames) out[name] = labels[name] ?? ''
  return out
}

function seriesKey(labelNames: readonly string[], labels: Labels): string {
  return labelNames.map((name) => labels[name] ?? '').join('\x1f')
}

interface Metric {
  readonly name: string
  render(): string
}

/** A monotonically increasing counter. */
export class Counter implements Metric {
  private readonly series = new Map<string, { labels: Labels; value: number }>()
  /** Create a counter with a name, help text, and optional label names. */
  constructor(
    /** Metric name as exposed in the Prometheus output. */
    readonly name: string,
    /** Help text emitted on the `# HELP` line. */
    readonly help: string,
    /** Label names this counter's series are keyed by. */
    readonly labelNames: readonly string[] = [],
  ) {}

  /**
   * Add `value` (default 1, must be ≥ 0) to the series for `labels`.
   *
   * @param labels - Label values selecting the series to increment.
   * @param value - Non-negative amount to add (default 1).
   */
  inc(labels: Labels = {}, value = 1): void {
    if (value < 0) throw new Error('Counter increments must be non-negative.')
    const key = seriesKey(this.labelNames, labels)
    const existing = this.series.get(key)
    if (existing) existing.value += value
    else this.series.set(key, { labels: pick(this.labelNames, labels), value })
  }

  /**
   * Render this counter in Prometheus exposition format.
   *
   * @returns The `# HELP`/`# TYPE` header and one line per series.
   */
  render(): string {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ]
    for (const { labels, value } of this.series.values()) {
      lines.push(`${this.name}${renderLabels(labels)} ${value}`)
    }
    return lines.join('\n')
  }
}

/** A value that can go up or down. */
export class Gauge implements Metric {
  private readonly series = new Map<string, { labels: Labels; value: number }>()
  /** Create a gauge with a name, help text, and optional label names. */
  constructor(
    /** Metric name as exposed in the Prometheus output. */
    readonly name: string,
    /** Help text emitted on the `# HELP` line. */
    readonly help: string,
    /** Label names this gauge's series are keyed by. */
    readonly labelNames: readonly string[] = [],
  ) {}

  private at(labels: Labels): { labels: Labels; value: number } {
    const key = seriesKey(this.labelNames, labels)
    let entry = this.series.get(key)
    if (!entry) {
      entry = { labels: pick(this.labelNames, labels), value: 0 }
      this.series.set(key, entry)
    }
    return entry
  }

  /**
   * Set the series for `labels` to `value`.
   *
   * @param labels - Label values selecting the series to set.
   * @param value - The value to assign.
   */
  set(labels: Labels, value: number): void {
    this.at(labels).value = value
  }
  /**
   * Add `value` (default 1) to the series for `labels`.
   *
   * @param labels - Label values selecting the series.
   * @param value - Amount to add (default 1).
   */
  inc(labels: Labels = {}, value = 1): void {
    this.at(labels).value += value
  }
  /**
   * Subtract `value` (default 1) from the series for `labels`.
   *
   * @param labels - Label values selecting the series.
   * @param value - Amount to subtract (default 1).
   */
  dec(labels: Labels = {}, value = 1): void {
    this.at(labels).value -= value
  }

  /**
   * Render this gauge in Prometheus exposition format.
   *
   * @returns The `# HELP`/`# TYPE` header and one line per series.
   */
  render(): string {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
    ]
    for (const { labels, value } of this.series.values()) {
      lines.push(`${this.name}${renderLabels(labels)} ${value}`)
    }
    return lines.join('\n')
  }
}

interface HistogramSeries {
  labels: Labels
  counts: number[]
  sum: number
  count: number
}

/** A cumulative histogram of observed values. */
export class Histogram implements Metric {
  /** Upper bounds of the cumulative buckets, ascending. */
  readonly buckets: number[]
  private readonly series = new Map<string, HistogramSeries>()
  /** Create a histogram with a name, help text, label names, and buckets. */
  constructor(
    /** Metric name as exposed in the Prometheus output. */
    readonly name: string,
    /** Help text emitted on the `# HELP` line. */
    readonly help: string,
    /** Label names this histogram's series are keyed by. */
    readonly labelNames: readonly string[] = [],
    buckets: readonly number[] = DEFAULT_BUCKETS,
  ) {
    this.buckets = [...buckets].sort((a, b) => a - b)
  }

  /**
   * Record `value` into the series for `labels`.
   *
   * @param labels - Label values selecting the series.
   * @param value - The observed value to record.
   */
  observe(labels: Labels, value: number): void {
    const key = seriesKey(this.labelNames, labels)
    let entry = this.series.get(key)
    if (!entry) {
      entry = {
        labels: pick(this.labelNames, labels),
        counts: new Array(this.buckets.length).fill(0),
        sum: 0,
        count: 0,
      }
      this.series.set(key, entry)
    }
    entry.sum += value
    entry.count += 1
    // Buckets are ascending, so incrementing every bucket whose bound the value
    // fits under yields already-cumulative counts.
    this.buckets.forEach((bound, i) => {
      if (value <= bound) entry.counts[i] = (entry.counts[i] ?? 0) + 1
    })
  }

  /**
   * Render this histogram (bucket, sum, and count series) in Prometheus exposition format.
   *
   * @returns The `# HELP`/`# TYPE` header and the bucket, sum, and count lines per series.
   */
  render(): string {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ]
    for (const entry of this.series.values()) {
      this.buckets.forEach((bound, i) => {
        lines.push(
          `${this.name}_bucket${renderLabels(entry.labels, ['le', String(bound)])} ${entry.counts[i]}`,
        )
      })
      lines.push(
        `${this.name}_bucket${renderLabels(entry.labels, ['le', '+Inf'])} ${entry.count}`,
      )
      lines.push(`${this.name}_sum${renderLabels(entry.labels)} ${entry.sum}`)
      lines.push(
        `${this.name}_count${renderLabels(entry.labels)} ${entry.count}`,
      )
    }
    return lines.join('\n')
  }
}

/**
 * A registry of metrics that renders the Prometheus text exposition format.
 * Register your app's custom metrics here and bind the same instance as a
 * provider (`{ provide: MetricsRegistry, useValue: registry }`) so controllers
 * can `inject(MetricsRegistry)` the one the {@link metrics} plugin records into.
 */
export class MetricsRegistry {
  private readonly metrics = new Map<string, Metric>()

  private register<M extends Metric>(metric: M): M {
    const existing = this.metrics.get(metric.name)
    if (existing) return existing as M
    this.metrics.set(metric.name, metric)
    return metric
  }

  /**
   * Get or create a counter (idempotent by name).
   *
   * @param name - Metric name, also the registry key.
   * @param help - Help text for the `# HELP` line.
   * @param labelNames - Label names the counter's series are keyed by.
   * @returns The new or previously registered counter with that name.
   */
  counter(
    name: string,
    help: string,
    labelNames: readonly string[] = [],
  ): Counter {
    return this.register(new Counter(name, help, labelNames))
  }
  /**
   * Get or create a gauge (idempotent by name).
   *
   * @param name - Metric name, also the registry key.
   * @param help - Help text for the `# HELP` line.
   * @param labelNames - Label names the gauge's series are keyed by.
   * @returns The new or previously registered gauge with that name.
   */
  gauge(name: string, help: string, labelNames: readonly string[] = []): Gauge {
    return this.register(new Gauge(name, help, labelNames))
  }
  /**
   * Get or create a histogram (idempotent by name).
   *
   * @param name - Metric name, also the registry key.
   * @param help - Help text for the `# HELP` line.
   * @param labelNames - Label names the histogram's series are keyed by.
   * @param buckets - Upper bounds for the cumulative buckets (default {@link DEFAULT_BUCKETS}).
   * @returns The new or previously registered histogram with that name.
   */
  histogram(
    name: string,
    help: string,
    labelNames: readonly string[] = [],
    buckets: readonly number[] = DEFAULT_BUCKETS,
  ): Histogram {
    return this.register(new Histogram(name, help, labelNames, buckets))
  }

  /**
   * The full exposition text (one block per metric, trailing newline).
   *
   * @returns The Prometheus exposition text for every registered metric.
   */
  render(): string {
    return `${[...this.metrics.values()].map((m) => m.render()).join('\n')}\n`
  }
}

/** Options for {@link metrics}. */
export interface MetricsOptions {
  /** Registry to record into (default: a fresh one). Share it to add custom metrics. */
  registry?: MetricsRegistry
  /** Path the metrics are exposed at (default `"/metrics"`). */
  endpoint?: string
  /** Latency histogram buckets in seconds (default {@link DEFAULT_BUCKETS}). */
  buckets?: readonly number[]
}

/**
 * Plugin: auto-instrument HTTP traffic and expose Prometheus metrics. Records
 * `http_requests_total` (counter), `http_request_duration_seconds` (histogram),
 * and `http_requests_in_flight` (gauge) — labelled by method, route *pattern*
 * (low cardinality), and status — and serves the exposition format at
 * `endpoint`. The scrape endpoint is served before routing, so it isn't counted.
 *
 * ```ts
 * const app = await createApp({ plugins: [metrics()] }) // GET /metrics
 * ```
 *
 * @param options - Registry to record into, endpoint path, and histogram buckets.
 * @returns A plugin that instruments requests and serves the metrics endpoint.
 */
export function metrics(options: MetricsOptions = {}): Plugin {
  const registry = options.registry ?? new MetricsRegistry()
  const endpoint = options.endpoint ?? '/metrics'
  const labelNames = ['method', 'route', 'status'] as const
  const total = registry.counter(
    'http_requests_total',
    'Total HTTP requests.',
    labelNames,
  )
  const duration = registry.histogram(
    'http_request_duration_seconds',
    'HTTP request latency in seconds.',
    labelNames,
    options.buckets,
  )
  const inFlight = registry.gauge(
    'http_requests_in_flight',
    'HTTP requests currently being handled.',
  )

  const onRequest: RequestHook = (req) => {
    if (req.method === 'GET' && new URL(req.url).pathname === endpoint) {
      return new Response(registry.render(), {
        headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' },
      })
    }
  }

  const wrap: Interceptor = async (ctx, next) => {
    inFlight.inc()
    const start = performance.now()
    let status = 500
    try {
      const res = await next()
      status = res.status
      return res
    } finally {
      inFlight.dec()
      const labels: Labels = {
        method: ctx.req.method,
        route: ctx.route || 'unmatched',
        status: String(status),
      }
      total.inc(labels)
      duration.observe(labels, (performance.now() - start) / 1000)
    }
  }

  return { onRequest, wrap }
}
