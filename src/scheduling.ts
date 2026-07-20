import type { PostProcessor } from './di'
import { type Ctor, ctxMeta, metadataOf, SCHEDULED } from './metadata'

/** Options for the `@scheduled` decorator. */
export interface ScheduledOptions {
  /** Fixed interval between runs, in milliseconds. */
  interval: number
  /** Also run once immediately when the app starts. */
  runOnStart?: boolean
}

interface ScheduledTask extends ScheduledOptions {
  run: () => unknown
}

/**
 * Runs `@scheduled` tasks on fixed intervals. Started by `app.listen()` and
 * stopped by `app.stop()`. A failing run is logged, not propagated.
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

  /** Start all registered tasks. */
  start(): void {
    if (this.started) return
    this.started = true
    for (const task of this.tasks) this.schedule(task)
  }

  /** Stop all tasks. */
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
 * @param options - the run `interval` in ms and whether to `runOnStart`
 * @returns a method decorator that registers the task on construction
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
