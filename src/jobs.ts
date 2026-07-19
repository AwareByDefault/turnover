/** Lifecycle state of a queued job. */
export type JobStatus = 'pending' | 'completed' | 'failed'

/** A unit of deferred work. */
export interface Job<T = unknown> {
  readonly id: string
  readonly type: string
  readonly payload: T
  /** How many times the handler has run (including the current attempt). */
  attempts: number
  /** Attempts allowed before the job is dead-lettered. */
  readonly maxAttempts: number
  /** Epoch ms the job is eligible to run at (for delays and backoff). */
  runAt: number
  status: JobStatus
  /** Message of the last handler error, if any. */
  lastError?: string
}

/** Handles one job type; throwing schedules a retry (or dead-letters). */
export type JobHandler<T = unknown> = (
  payload: T,
  job: Job<T>,
) => void | Promise<void>

/** Pluggable job storage. The default is in-memory; back it with a database for durability. */
export interface JobStore {
  add(job: Job): void
  /** Pending jobs eligible at `now`, soonest first. */
  due(now: number): Job[]
  save(job: Job): void
  /** Dead-lettered jobs (attempts exhausted). */
  failed(): Job[]
  /** Count of jobs still pending. */
  pending(): number
}

function memoryJobStore(): JobStore {
  const jobs = new Map<string, Job>()
  return {
    add(job) {
      jobs.set(job.id, job)
    },
    save(job) {
      jobs.set(job.id, job)
    },
    due(now) {
      return [...jobs.values()]
        .filter((job) => job.status === 'pending' && job.runAt <= now)
        .sort((a, b) => a.runAt - b.runAt)
    },
    failed() {
      return [...jobs.values()].filter((job) => job.status === 'failed')
    },
    pending() {
      let count = 0
      for (const job of jobs.values()) if (job.status === 'pending') count += 1
      return count
    },
  }
}

/** Options for {@link JobQueue}. */
export interface JobQueueOptions {
  /** Storage backend (default in-memory). */
  store?: JobStore
  /** Default attempt limit per job (default 3). */
  maxAttempts?: number
  /** Retry delay (ms) before attempt N. Default exponential: `1000 * 2^(N-2)`. */
  backoff?: (attempt: number) => number
  /** Clock source (default `Date.now`). Override for deterministic tests. */
  clock?: () => number
}

/** Options for a single {@link JobQueue.enqueue}. */
export interface EnqueueOptions {
  /** Delay before the job becomes eligible, in ms. */
  delay?: number
  /** Override the queue's default attempt limit. */
  maxAttempts?: number
}

/**
 * An in-process background job queue with retries, exponential backoff, delays,
 * and a dead-letter list. Register a handler per job `type`, `enqueue` work, and
 * drain it — either by calling {@link JobQueue.process} yourself (deterministic;
 * ideal in tests) or by letting {@link JobQueue.start} poll on an interval. A
 * throwing handler reschedules the job with backoff until its attempts are
 * exhausted, after which it lands in {@link JobQueue.failed}.
 *
 * ```ts
 * const jobs = new JobQueue()
 * jobs.on('email', async ({ to }) => send(to))
 * await jobs.enqueue('email', { to: 'ada@acme.io' })
 * jobs.start() // process every second
 * ```
 */
export class JobQueue {
  private readonly store: JobStore
  private readonly handlers = new Map<string, JobHandler>()
  private readonly defaultMaxAttempts: number
  private readonly backoff: (attempt: number) => number
  private readonly now: () => number
  private timer: ReturnType<typeof setInterval> | undefined
  private seq = 0

  constructor(options: JobQueueOptions = {}) {
    this.store = options.store ?? memoryJobStore()
    this.defaultMaxAttempts = options.maxAttempts ?? 3
    this.backoff = options.backoff ?? ((attempt) => 1000 * 2 ** (attempt - 2))
    this.now = options.clock ?? Date.now
  }

  /** Register the handler for a job `type` (one per type; last wins). */
  on<T>(type: string, handler: JobHandler<T>): this {
    this.handlers.set(type, handler as JobHandler)
    return this
  }

  /** Enqueue a job and return its id. */
  enqueue<T>(type: string, payload: T, options: EnqueueOptions = {}): string {
    this.seq += 1
    const id = `${type}-${this.seq}-${Math.floor(this.now())}`
    const job: Job<T> = {
      id,
      type,
      payload,
      attempts: 0,
      maxAttempts: options.maxAttempts ?? this.defaultMaxAttempts,
      runAt: this.now() + (options.delay ?? 0),
      status: 'pending',
    }
    this.store.add(job as Job)
    return id
  }

  /**
   * Run every job eligible at `now` (default the queue clock) once, in due
   * order, and return how many ran. A handler that throws (or a missing handler)
   * reschedules with backoff, or dead-letters once attempts are spent.
   */
  async process(now: number = this.now()): Promise<number> {
    const due = this.store.due(now)
    for (const job of due) {
      job.attempts += 1
      try {
        const handler = this.handlers.get(job.type)
        if (!handler)
          throw new Error(`No handler registered for "${job.type}".`)
        await handler(job.payload, job)
        job.status = 'completed'
        job.lastError = undefined
      } catch (error) {
        job.lastError = error instanceof Error ? error.message : String(error)
        if (job.attempts >= job.maxAttempts) {
          job.status = 'failed'
        } else {
          job.runAt = now + Math.max(0, this.backoff(job.attempts + 1))
        }
      }
      this.store.save(job)
    }
    return due.length
  }

  /** Start polling: run {@link JobQueue.process} every `intervalMs` (default 1000). */
  start(intervalMs = 1000): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.process()
    }, intervalMs)
  }

  /** Stop polling started by {@link JobQueue.start}. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  /** Jobs that exhausted their attempts (the dead-letter list). */
  failed(): Job[] {
    return this.store.failed()
  }

  /** Number of jobs still pending. */
  pending(): number {
    return this.store.pending()
  }
}
