import { type Container, InjectionToken, type PostProcessor } from './di'
import { type Ctor, ctxMeta, metadataOf, TRANSACTIONAL } from './metadata'

/** Runs a unit of work: begin → `fn` → commit, or rollback if `fn` throws. */
export interface TransactionManager {
  run<T>(fn: () => T | Promise<T>): Promise<T>
}

/** Bind your database's transaction manager here (`{ provide: TRANSACTION_MANAGER, useValue }`). */
export const TRANSACTION_MANAGER = new InjectionToken<TransactionManager>(
  'TransactionManager',
)

/** The default when none is bound: just runs `fn` (no real transaction). */
const NOOP_MANAGER: TransactionManager = { run: async (fn) => fn() }

/**
 * Method decorator: run this method inside a transaction from the bound
 * `TransactionManager` (commit on success, roll back on error) — the result
 * becomes a `Promise`. With no manager bound there is no transaction to run, so
 * the method executes as-is (a synchronous method stays synchronous).
 */
export function transactional(
  _value: unknown,
  context: ClassMethodDecoratorContext,
): void {
  const meta = ctxMeta(context)
  const set = (meta[TRANSACTIONAL] as Set<PropertyKey> | undefined) ?? new Set()
  set.add(context.name)
  meta[TRANSACTIONAL] = set
}

/**
 * A post-processor that wraps `@transactional` methods in the container's
 * `TransactionManager`. Registered automatically by `createApp`.
 */
export function transactionalProcessor(container: Container): PostProcessor {
  return (instance, token: Ctor) => {
    const methods = metadataOf(token)?.[TRANSACTIONAL] as
      | Set<PropertyKey>
      | undefined
    if (!methods || methods.size === 0) return instance
    return new Proxy(instance, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target)
        if (typeof value !== 'function') return value
        const fn = value as (...args: unknown[]) => unknown
        if (typeof prop === 'string' && methods.has(prop)) {
          return (...args: unknown[]) => {
            const manager = container.resolveOptional(
              TRANSACTION_MANAGER,
              NOOP_MANAGER,
            )
            // No real manager → nothing to run in; call through so a synchronous
            // method stays synchronous (this is what keeps @repository from
            // making every DAO call async when transactions aren't configured).
            if (manager === NOOP_MANAGER) return fn.apply(target, args)
            return manager.run(() => fn.apply(target, args))
          }
        }
        return fn.bind(target)
      },
    })
  }
}
