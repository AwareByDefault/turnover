import type { PostProcessor } from './di'
import {
  ADVICE,
  type Ctor,
  ctxMeta,
  type MetaBag,
  metadataOf,
} from './metadata'

/** The context of an advised method call. */
export interface JoinPoint {
  /** The (unwrapped) instance the method belongs to. */
  readonly target: object
  /** The method name. */
  readonly method: string
  /** The call arguments. */
  readonly args: readonly unknown[]
}

/** A {@link JoinPoint} that can run the wrapped method via `proceed()`. */
export interface ProceedingJoinPoint extends JoinPoint {
  /** Invoke the method (optionally with different args); returns its result. */
  proceed(args?: unknown[]): unknown
}

export type BeforeAdvice = (joinPoint: JoinPoint) => void
export type AfterAdvice = (joinPoint: JoinPoint) => void
export type AroundAdvice = (joinPoint: ProceedingJoinPoint) => unknown

interface AdviceSet {
  before: BeforeAdvice[]
  after: AfterAdvice[]
  around: AroundAdvice[]
}

type AdviceMap = Map<PropertyKey, AdviceSet>

function adviceSetFor(meta: MetaBag, name: PropertyKey): AdviceSet {
  const map = (meta[ADVICE] as AdviceMap | undefined) ?? new Map()
  let set = map.get(name)
  if (!set) {
    set = { before: [], after: [], around: [] }
    map.set(name, set)
  }
  meta[ADVICE] = map
  return set
}

function adviceFor(context: ClassMethodDecoratorContext): AdviceSet {
  return adviceSetFor(ctxMeta(context), context.name)
}

/**
 * Register `around` advice for a named method directly on a metadata bag — the
 * programmatic form of `@around`, for applying advice to many methods at once
 * (e.g. a class-level `@traced()` that wraps every public method).
 */
export function addAround(
  meta: MetaBag,
  method: PropertyKey,
  advice: AroundAdvice,
): void {
  adviceSetFor(meta, method).around.push(advice)
}

/** Method decorator: run `advice` before the method (sync side effects). */
export function before(advice: BeforeAdvice) {
  return (_v: unknown, context: ClassMethodDecoratorContext): void => {
    adviceFor(context).before.push(advice)
  }
}

/** Method decorator: run `advice` after the method (finally; awaits async methods). */
export function after(advice: AfterAdvice) {
  return (_v: unknown, context: ClassMethodDecoratorContext): void => {
    adviceFor(context).after.push(advice)
  }
}

/** Method decorator: wrap the method — call `joinPoint.proceed()` to run it. */
export function around(advice: AroundAdvice) {
  return (_v: unknown, context: ClassMethodDecoratorContext): void => {
    adviceFor(context).around.push(advice)
  }
}

/** Apply a method's advice chain: around wraps (before → method), then after. */
function applyAdvice(
  target: object,
  method: string,
  original: (...args: unknown[]) => unknown,
  args: unknown[],
  set: AdviceSet,
): unknown {
  const runAfter = () => {
    for (const advice of set.after) advice({ target, method, args })
  }

  // Innermost: before advice, then the method itself.
  const base = (callArgs: unknown[]): unknown => {
    for (const advice of set.before) advice({ target, method, args: callArgs })
    return original.apply(target, callArgs)
  }

  // Wrap with around advice. Decorators apply bottom-up, so wrapping forward
  // through the recorded order makes the top-most `@around` the outermost.
  let proceed = base
  for (const advice of set.around) {
    const inner = proceed
    proceed = (callArgs: unknown[]) =>
      advice({
        target,
        method,
        args: callArgs,
        proceed: (a?: unknown[]) => inner(a ?? callArgs),
      })
  }

  let result: unknown
  try {
    result = proceed(args)
  } catch (err) {
    runAfter()
    throw err
  }
  // Run `after` once the method truly finishes (after the promise for async).
  if (result instanceof Promise) return result.finally(runAfter)
  runAfter()
  return result
}

/**
 * A container post-processor that proxies instances whose methods carry
 * `@before`/`@after`/`@around` advice. Registered automatically by `createApp`.
 * Self-invocation inside a method reaches the raw object, so a method's calls
 * to its own other methods are not advised.
 */
export const aspectProcessor: PostProcessor = (instance, token: Ctor) => {
  const advice = metadataOf(token)?.[ADVICE] as AdviceMap | undefined
  if (!advice || advice.size === 0) return instance

  return new Proxy(instance, {
    get(target, prop) {
      // Use `target` as the receiver so getters and #private fields resolve
      // against the real instance, not the proxy.
      const value = Reflect.get(target, prop, target)
      if (typeof prop !== 'string' || typeof value !== 'function') return value

      const set = advice.get(prop)
      const fn = value as (...args: unknown[]) => unknown
      if (set) {
        return (...args: unknown[]) => applyAdvice(target, prop, fn, args, set)
      }
      // Non-advised method: bind to the raw target (private-field safe).
      return (...args: unknown[]) => fn.apply(target, args)
    },
  })
}
