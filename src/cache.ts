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
  /**
   * Return the value stored under `key`, or `undefined` if absent or expired.
   *
   * @param key - The cache key to look up.
   * @returns The stored value, or `undefined` if absent or expired.
   */
  get(key: string): Promise<unknown>
  /**
   * Store `value` under `key`, optionally expiring it after `ttlMs`.
   *
   * @param key - The cache key to store under.
   * @param value - The value to cache.
   * @param ttlMs - Optional lifetime in milliseconds; omit for no expiry.
   */
  set(key: string, value: unknown, ttlMs?: number): Promise<void>
  /**
   * Remove the entry stored under `key`. Idempotent — a no-op if the key is
   * absent or already expired.
   *
   * @param key - The cache key to remove.
   */
  delete(key: string): Promise<void>
  /**
   * Remove **every** entry in the store, regardless of key prefix. This is the
   * store-wide sweep {@link cacheEvict} triggers, so with a shared store it also
   * drops cache entries written by other classes.
   */
  clear(): Promise<void>
}

/** Bind a cache backend here; defaults to an in-memory store. */
export const CACHE_STORE = new InjectionToken<CacheStore>('CacheStore')

/**
 * The default {@link CacheStore}: a process-local `Map` with per-entry TTL.
 * Expiry is lazy — an entry is purged only when next read via {@link MemoryCache.get}, so an
 * unread expired entry keeps its memory until then, and the map is unbounded (no
 * max size or LRU). Not shared across replicas; back `@cacheable` with a shared
 * store such as `redisCacheStore` for that.
 */
export class MemoryCache implements CacheStore {
  private readonly store = new Map<
    string,
    { value: unknown; expires: number }
  >()

  /**
   * Return the value stored under `key`, or `undefined` if absent or expired.
   * Reading an expired entry also evicts it as a side effect (lazy expiry).
   *
   * @param key - The cache key to look up.
   * @returns The stored value, or `undefined` if absent or expired.
   */
  async get(key: string): Promise<unknown> {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expires !== 0 && entry.expires <= Date.now()) {
      this.store.delete(key)
      return undefined
    }
    return entry.value
  }

  /**
   * Store `value` under `key`, optionally expiring it after `ttlMs`.
   *
   * @param key - The cache key to store under.
   * @param value - The value to cache.
   * @param ttlMs - Optional lifetime in milliseconds; omit for no expiry.
   */
  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    this.store.set(key, { value, expires: ttlMs ? Date.now() + ttlMs : 0 })
  }

  /**
   * Remove the entry stored under `key`.
   *
   * @param key - The cache key to remove.
   */
  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  /** Remove every entry. */
  async clear(): Promise<void> {
    this.store.clear()
  }
}

const DEFAULT_CACHE = new MemoryCache()

/** Options for the `@cacheable` decorator. */
export interface CacheableOptions {
  /** Key prefix (default: the method name). */
  key?: string
  /** Time-to-live in milliseconds (default: no expiry). */
  ttl?: number
  /** Derive the key suffix from the call arguments; the returned string must uniquely identify the args, or distinct calls collide on one entry (default: `JSON.stringify(args)`). */
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
 *
 * @remarks
 * The entry key is the `key` option (or the method name) joined by `:` to
 * `keyBy(...args)` (or `JSON.stringify(args)` by default). A resolved value of
 * `undefined` is never cached — it reads back as a miss, so such calls re-run
 * every time.
 *
 * @param options - Key prefix, TTL, and key-derivation overrides for the cache entry.
 * @returns A method decorator that memoizes the method via the bound `CacheStore`.
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

/**
 * Method decorator: clear the **entire** bound `CacheStore` — every entry, not
 * just this method's — *before* the wrapped method body runs. Because eviction
 * happens first, a throwing method still empties the cache. Use with a shared
 * store carefully: it also drops other classes' `@cacheable` entries.
 *
 * @param _value - The decorated method (unused; standard-decorator plumbing).
 * @param context - Method-decorator context; its `name` records the evict marker.
 */
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
 *
 * @param container - The DI container used to resolve the active `CacheStore`.
 * @returns A post-processor that wraps `@cacheable` / `@cacheEvict` methods.
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
