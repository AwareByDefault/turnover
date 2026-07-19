import { type Container, InjectionToken, type PostProcessor } from './di'
import {
  CACHE_EVICT,
  CACHEABLE,
  type Ctor,
  ctxMeta,
  metadataOf,
} from './metadata'

/**
 * A key/value cache with optional per-entry TTL. Async so a shared backend
 * (Redis, a database) can back it; {@link MemoryCache} is the in-process default.
 */
export interface CacheStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown, ttlMs?: number): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}

/** Bind a cache backend here; defaults to an in-memory store. */
export const CACHE_STORE = new InjectionToken<CacheStore>('CacheStore')

/** The default in-memory cache (per-entry TTL). */
export class MemoryCache implements CacheStore {
  private readonly store = new Map<
    string,
    { value: unknown; expires: number }
  >()

  async get(key: string): Promise<unknown> {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expires !== 0 && entry.expires <= Date.now()) {
      this.store.delete(key)
      return undefined
    }
    return entry.value
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    this.store.set(key, { value, expires: ttlMs ? Date.now() + ttlMs : 0 })
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async clear(): Promise<void> {
    this.store.clear()
  }
}

const DEFAULT_CACHE = new MemoryCache()

export interface CacheableOptions {
  /** Key prefix (default: the method name). */
  key?: string
  /** Time-to-live in milliseconds (default: no expiry). */
  ttl?: number
  /** Derive the key suffix from the arguments (default: JSON of the args). */
  keyBy?: (...args: any[]) => string
}

interface CacheableMeta extends CacheableOptions {
  method: PropertyKey
}

/** Build the cache key for a `@cacheable` call. */
function cacheKey(opts: CacheableMeta, args: unknown[]): string {
  const suffix = opts.keyBy ? opts.keyBy(...args) : JSON.stringify(args)
  return `${String(opts.key ?? opts.method)}:${suffix}`
}

/**
 * Method decorator: memoize the method's result by its arguments in the bound
 * `CacheStore` (default in-memory). Because the store is async, a `@cacheable`
 * method always returns a `Promise` — `await` it even when the underlying body
 * is synchronous.
 */
export function cacheable(options: CacheableOptions = {}) {
  return (_value: unknown, context: ClassMethodDecoratorContext): void => {
    const meta = ctxMeta(context)
    const map =
      (meta[CACHEABLE] as Map<PropertyKey, CacheableMeta> | undefined) ??
      new Map()
    map.set(context.name, { ...options, method: context.name })
    meta[CACHEABLE] = map
  }
}

/** Method decorator: clear the cache when this method is called. */
export function cacheEvict(
  _value: unknown,
  context: ClassMethodDecoratorContext,
): void {
  const meta = ctxMeta(context)
  const set = (meta[CACHE_EVICT] as Set<PropertyKey> | undefined) ?? new Set()
  set.add(context.name)
  meta[CACHE_EVICT] = set
}

/**
 * A post-processor that applies `@cacheable` / `@cacheEvict` using the container's
 * `CacheStore`. Registered automatically by `createApp`.
 */
export function cacheProcessor(container: Container): PostProcessor {
  return (instance, token: Ctor) => {
    const cacheables = metadataOf(token)?.[CACHEABLE] as
      | Map<PropertyKey, CacheableMeta>
      | undefined
    const evicts = metadataOf(token)?.[CACHE_EVICT] as
      | Set<PropertyKey>
      | undefined
    if (!cacheables && !evicts) return instance

    return new Proxy(instance, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target)
        if (typeof value !== 'function') return value
        const fn = value as (...args: unknown[]) => unknown
        const opts =
          typeof prop === 'string' ? cacheables?.get(prop) : undefined

        if (opts) {
          // The store is async, so a @cacheable method always returns a Promise
          // (it awaits the lookup) — call it with `await`.
          return async (...args: unknown[]) => {
            const store = container.resolveOptional(CACHE_STORE, DEFAULT_CACHE)
            const key = cacheKey(opts, args)
            const hit = await store.get(key)
            if (hit !== undefined) return hit
            const result = await fn.apply(target, args)
            await store.set(key, result, opts.ttl)
            return result
          }
        }
        if (typeof prop === 'string' && evicts?.has(prop)) {
          return async (...args: unknown[]) => {
            await container.resolveOptional(CACHE_STORE, DEFAULT_CACHE).clear()
            return fn.apply(target, args)
          }
        }
        return fn.bind(target)
      },
    })
  }
}
