import { type Container, InjectionToken, type PostProcessor } from './di'
import {
  type Ctor,
  ctxMeta,
  metadataOf,
  REPOSITORY,
  TRANSACTIONAL,
} from './metadata'

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
 * `TransactionManager` (commit on success, roll back on error). The method's
 * result becomes a `Promise`.
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

/** The class's own method names (excluding the constructor). */
function ownMethodNames(token: Ctor): string[] {
  const proto = token.prototype as object
  return Object.getOwnPropertyNames(proto).filter((name) => {
    if (name === 'constructor') return false
    return (
      typeof Object.getOwnPropertyDescriptor(proto, name)?.value === 'function'
    )
  })
}

/**
 * A post-processor that wraps `@transactional` methods — and every own method of
 * an `@repository` class — in the container's `TransactionManager`. Registered
 * automatically by `createApp`.
 */
export function transactionalProcessor(container: Container): PostProcessor {
  return (instance, token: Ctor) => {
    const meta = metadataOf(token)
    const wrap = new Set<PropertyKey>(
      (meta?.[TRANSACTIONAL] as Set<PropertyKey> | undefined) ?? [],
    )
    if (meta?.[REPOSITORY] === true) {
      for (const name of ownMethodNames(token)) wrap.add(name)
    }
    if (wrap.size === 0) return instance
    return new Proxy(instance, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target)
        if (typeof value !== 'function') return value
        const fn = value as (...args: unknown[]) => unknown
        if (typeof prop === 'string' && wrap.has(prop)) {
          return (...args: unknown[]) => {
            const manager = container.resolveOptional(
              TRANSACTION_MANAGER,
              NOOP_MANAGER,
            )
            return manager.run(() => fn.apply(target, args))
          }
        }
        return fn.bind(target)
      },
    })
  }
}
