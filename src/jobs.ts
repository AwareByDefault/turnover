/**
 * Lifecycle state of a queued job: `pending` until a handler succeeds
 * (`completed`) or its attempts run out (`failed`). There is no separate
 * "running" state.
 */
export type JobStatus = 'pending' | 'completed' | 'failed'

/** A unit of deferred work. */
export interface Job<T = unknown> {
  /** Unique id assigned at enqueue time, of the form `type-seq-enqueueMillis`. */
  readonly id: string
  /** The registered handler type this job routes to. */
  readonly type: string
  /** Arbitrary work data handed to the handler. */
  readonly payload: T
  /** How many times the handler has run (including the current attempt). */
  attempts: number
  /** Attempts allowed before the job is dead-lettered. */
  readonly maxAttempts: number
  /** Epoch ms the job is eligible to run at (for delays and backoff). */
  runAt: number
  /** Current lifecycle state; see {@link JobStatus}. */
  status: JobStatus
  /** `message` of the error thrown by the most recent failed attempt (no stack); cleared once an attempt succeeds. */
  lastError?: string
}

/** Handles one job type; throwing schedules a retry (or dead-letters). */
export type JobHandler<T = unknown> = (
  payload: T,
  job: Job<T>,
) => void | Promise<void>

/**
 * Pluggable job storage. Async so a durable backend (Redis, a database) can back
 * it; the default is in-memory.
 */
export interface JobStore {
  /**
   * Persist a newly enqueued job, keyed by its `id`.
   *
   * @param job - The newly enqueued job (status `pending`) to store.
   */
  add(job: Job): Promise<void>
  /**
   * Pending jobs eligible at `now`, soonest first.
   *
   * @param now - Epoch ms cutoff; jobs whose `runAt` is at or before this are due.
   * @returns The eligible pending jobs, soonest `runAt` first.
   */
  due(now: number): Promise<Job[]>
  /**
   * Persist an updated job, replacing any prior record with the same `id`.
   *
   * @param job - The job whose mutated state (attempts, status, `runAt`) should be written back.
   */
  save(job: Job): Promise<void>
  /**
   * Dead-lettered jobs (attempts exhausted).
   *
   * @returns Every job that exhausted its attempts.
   */
  failed(): Promise<Job[]>
  /**
   * Count of jobs still pending.
   *
   * @returns The number of jobs still awaiting processing.
   */
  pending(): Promise<number>
}

function memoryJobStore(): JobStore {
  const jobs = new Map<string, Job>()
  return {
    async add(job) {
      jobs.set(job.id, job)
    },
    async save(job) {
      jobs.set(job.id, job)
    },
    async due(now) {
      return [...jobs.values()]
        .filter((job) => job.status === 'pending' && job.runAt <= now)
        .sort((a, b) => a.runAt - b.runAt)
    },
    async failed() {
      return [...jobs.values()].filter((job) => job.status === 'failed')
    },
    async pending() {
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
  /** Delay in milliseconds before attempt N (the number of the upcoming try). Default exponential `1000 * 2^(N-2)`: 1s before attempt 2, 2s before 3, 4s before 4. */
  backoff?: (attempt: number) => number
  /** Clock source (default `Date.now`). Override for deterministic tests. */
  clock?: () => number
}

/** Options for a single {@link JobQueue.enqueue}. */
export interface EnqueueOptions {
  /** Milliseconds to wait, measured from enqueue time, before the job becomes eligible to run (default 0 — eligible immediately). */
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

  /** Create a job queue, taking its store, attempt limit, backoff, and clock from `options`. */
  constructor(options: JobQueueOptions = {}) {
    this.store = options.store ?? memoryJobStore()
    this.defaultMaxAttempts = options.maxAttempts ?? 3
    this.backoff = options.backoff ?? ((attempt) => 1000 * 2 ** (attempt - 2))
    this.now = options.clock ?? Date.now
  }

  /**
   * Register the handler for a job `type` (one per type; last wins).
   *
   * @typeParam T - The payload type this handler expects.
   * @param type - The job type this handler is registered for.
   * @param handler - The function invoked with each job's payload of this type.
   */
  on<T>(type: string, handler: JobHandler<T>): this {
    this.handlers.set(type, handler as JobHandler)
    return this
  }

  /**
   * Enqueue a job and return its id.
   *
   * @typeParam T - The payload type for this job.
   * @param type - The registered handler type to route this job to.
   * @param payload - The work data handed to the handler.
   * @param options - Per-job delay and attempt-limit overrides.
   * @returns The generated id of the enqueued job.
   */
  async enqueue<T>(
    type: string,
    payload: T,
    options: EnqueueOptions = {},
  ): Promise<string> {
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
    await this.store.add(job as Job)
    return id
  }

  /**
   * Run every job eligible at `now` (default the queue clock) once, in due
   * order, and return how many ran. A handler that throws (or a missing handler)
   * reschedules with backoff, or dead-letters once attempts are spent.
   *
   * @param now - Epoch ms cutoff; jobs whose `runAt` is at or before it run (default the queue clock).
   * @returns How many jobs ran this pass.
   */
  async process(now: number = this.now()): Promise<number> {
    const due = await this.store.due(now)
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
      await this.store.save(job)
    }
    return due.length
  }

  /**
   * Start background polling: run {@link JobQueue.process} on a fixed interval.
   * Idempotent — a second call while already polling is a no-op; call
   * {@link JobQueue.stop} before `start` to change the interval.
   *
   * @param intervalMs - How often to poll for due jobs, in milliseconds (default 1000).
   */
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

  /**
   * Jobs that exhausted their attempts (the dead-letter list).
   *
   * @returns The dead-lettered jobs.
   */
  failed(): Promise<Job[]> {
    return this.store.failed()
  }

  /**
   * Number of jobs still pending.
   *
   * @returns The number of jobs still awaiting processing.
   */
  pending(): Promise<number> {
    return this.store.pending()
  }
}
