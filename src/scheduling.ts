import type { PostProcessor } from './di'
import { type Ctor, ctxMeta, metadataOf, SCHEDULED } from './metadata'

/** Options for the `@scheduled` decorator. */
export interface ScheduledOptions {
  /** Milliseconds between the starts of consecutive runs (a fixed `setInterval` period, not adjusted for run duration). */
  interval: number
  /**
   * When `true`, also fire once immediately at start — or at registration if the
   * app is already listening — instead of waiting a full `interval`. Default `false`.
   */
  runOnStart?: boolean
}

interface ScheduledTask extends ScheduledOptions {
  run: () => unknown
}

/**
 * Runs `@scheduled` tasks on fixed intervals via `setInterval`. Started by
 * `app.listen()`, stopped by `app.stop()`. Runs are not re-entrancy-guarded — a
 * task whose run outlasts its interval will overlap its next run. A failing run
 * (sync throw or rejected promise) is logged with a `[turnover]` prefix and
 * swallowed; the interval keeps firing.
 */
export class Scheduler {
  private readonly tasks: ScheduledTask[] = []
  private timers: ReturnType<typeof setInterval>[] = []
  private started = false

  /**
   * Register a task (used by the scheduling post-processor).
   *
   * @param task - the interval task to register (and start if already running)
   */
  add(task: ScheduledTask): void {
    this.tasks.push(task)
    // If already running, start this newly-added task too.
    if (this.started) this.schedule(task)
  }

  /** Begin all registered tasks; idempotent (a no-op once started). `runOnStart` tasks fire synchronously here. */
  start(): void {
    if (this.started) return
    this.started = true
    for (const task of this.tasks) this.schedule(task)
  }

  /** Clear every interval timer and reset to unstarted (so {@link Scheduler.start} may run again); an already-running task's current run is neither awaited nor cancelled. */
  stop(): void {
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
    this.started = false
  }

  private schedule(task: ScheduledTask): void {
    if (task.runOnStart) this.invoke(task)
    this.timers.push(setInterval(() => this.invoke(task), task.interval))
  }

  private invoke(task: ScheduledTask): void {
    try {
      const result = task.run()
      if (result instanceof Promise) {
        result.catch((err) =>
          console.error('[turnover] scheduled task failed:', err),
        )
      }
    } catch (err) {
      console.error('[turnover] scheduled task failed:', err)
    }
  }
}

/**
 * Method decorator: run this method on a fixed interval while the app is
 * listening. The service must be constructed (inject it, or list it in
 * `createApp({ listeners })`).
 *
 * ```ts
 * @injectable() class Reminders {
 *   @scheduled({ interval: 60_000 }) sweep() { ... }
 * }
 * ```
 *
 * @remarks Fires only while the app is listening. A run that outlasts its
 * `interval` overlaps the next tick (no re-entrancy guard), and a thrown/rejected
 * run is logged but not retried — the interval keeps firing regardless.
 *
 * @param options - the run `interval` in ms and whether to `runOnStart`
 * @returns a method decorator that registers the task when its service is constructed
 */
export function scheduled(options: ScheduledOptions) {
  return (_value: unknown, context: ClassMethodDecoratorContext): void => {
    const meta = ctxMeta(context)
    const map =
      (meta[SCHEDULED] as Map<PropertyKey, ScheduledOptions> | undefined) ??
      new Map()
    map.set(context.name, options)
    meta[SCHEDULED] = map
  }
}

/**
 * A post-processor that registers a constructed instance's `@scheduled` methods
 * with the scheduler. Registered automatically by `createApp`.
 *
 * @param scheduler - the scheduler to register discovered tasks with
 * @returns a {@link PostProcessor} that wires each instance's `@scheduled` methods
 */
export function schedulingProcessor(scheduler: Scheduler): PostProcessor {
  return (instance, token: Ctor) => {
    const tasks = metadataOf(token)?.[SCHEDULED] as
      | Map<PropertyKey, ScheduledOptions>
      | undefined
    if (tasks) {
      const methods = instance as Record<PropertyKey, () => unknown>
      for (const [method, options] of tasks) {
        const fn = methods[method]
        if (typeof fn === 'function') {
          scheduler.add({ ...options, run: () => fn.call(methods) })
        }
      }
    }
    return instance
  }
}
