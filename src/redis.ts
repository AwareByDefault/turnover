// Redis-backed adapters for turnover's async pluggable stores, so sessions and
// one-time codes survive restarts and are shared across replicas. Available at
// the `turnover/redis` subpath. Dependency-free: you pass in any client that
// satisfies the small `RedisClient` interface (Bun's built-in redis, ioredis,
// node-redis, …) — turnover never imports a Redis library.

import type { CacheStore } from './cache'
import type { Job, JobStore } from './jobs'
import type { OtpRecord, OtpStore } from './passwordless'
import type { SessionData, SessionStore } from './session'

/** The handful of Redis commands these adapters need. */
export interface RedisClient {
  get(key: string): Promise<string | null | undefined>
  set(key: string, value: string): Promise<unknown>
  del(key: string): Promise<unknown>
  /** Set a key's time-to-live in seconds. */
  expire(key: string, seconds: number): Promise<unknown>
}

/** A {@link RedisClient} that can also enumerate keys — needed to clear the cache. */
export interface RedisCacheClient extends RedisClient {
  keys(pattern: string): Promise<string[]>
}

/** Redis hash commands, used to store the job set under a single key. */
export interface RedisJobClient {
  hset(key: string, field: string, value: string): Promise<unknown>
  hgetall(key: string): Promise<Record<string, string>>
  hdel(key: string, field: string): Promise<unknown>
}

/** Options for {@link redisSessionStore}. */
export interface RedisSessionStoreOptions {
  /** Key prefix (default `"turnover:sess:"`). */
  prefix?: string
  /** TTL in seconds applied to every write (Redis expires idle sessions). */
  ttl?: number
}

/**
 * A {@link SessionStore} backed by Redis — for sessions shared across replicas.
 * Pass any client satisfying {@link RedisClient}.
 *
 * ```ts
 * import { redis } from 'bun'
 * const app = await createApp({
 *   plugins: [session({ store: redisSessionStore(redis, { ttl: 86_400 }) })],
 * })
 * ```
 */
export function redisSessionStore(
  client: RedisClient,
  options: RedisSessionStoreOptions = {},
): SessionStore {
  const prefix = options.prefix ?? 'turnover:sess:'
  return {
    async get(id) {
      const raw = await client.get(prefix + id)
      return raw ? (JSON.parse(raw) as SessionData) : undefined
    },
    async set(id, data) {
      const key = prefix + id
      await client.set(key, JSON.stringify(data))
      if (options.ttl !== undefined) await client.expire(key, options.ttl)
    },
    async destroy(id) {
      await client.del(prefix + id)
    },
  }
}

/** Options for {@link redisCacheStore}. */
export interface RedisCacheStoreOptions {
  /** Key prefix (default `"turnover:cache:"`). */
  prefix?: string
}

/**
 * A {@link CacheStore} backed by Redis — a shared backend for `@cacheable`
 * across replicas. Values are JSON-encoded with a per-entry TTL; `clear()`
 * removes only this store's prefixed keys (via `KEYS`, so reserve it for
 * eviction, not a hot path).
 *
 * ```ts
 * createApp({ providers: [{ provide: CACHE_STORE, useValue: redisCacheStore(redis) }] })
 * ```
 */
export function redisCacheStore(
  client: RedisCacheClient,
  options: RedisCacheStoreOptions = {},
): CacheStore {
  const prefix = options.prefix ?? 'turnover:cache:'
  return {
    async get(key) {
      const raw = await client.get(prefix + key)
      return raw ? JSON.parse(raw) : undefined
    },
    async set(key, value, ttlMs) {
      const redisKey = prefix + key
      await client.set(redisKey, JSON.stringify(value))
      if (ttlMs !== undefined) {
        await client.expire(redisKey, Math.max(1, Math.ceil(ttlMs / 1000)))
      }
    },
    async delete(key) {
      await client.del(prefix + key)
    },
    async clear() {
      const keys = await client.keys(`${prefix}*`)
      await Promise.all(keys.map((key) => client.del(key)))
    },
  }
}

/** Options for {@link redisOtpStore}. */
export interface RedisOtpStoreOptions {
  /** Key prefix (default `"turnover:otp:"`). */
  prefix?: string
  /** Clock source (default `Date.now`), used to derive each code's Redis TTL. */
  clock?: () => number
}

/**
 * An {@link OtpStore} backed by Redis — for passwordless codes shared across
 * replicas. Each entry is given a Redis TTL matching the code's own expiry, so
 * spent codes are cleaned up automatically.
 *
 * ```ts
 * const otp = new Passwordless({ store: redisOtpStore(redis) })
 * ```
 */
export function redisOtpStore(
  client: RedisClient,
  options: RedisOtpStoreOptions = {},
): OtpStore {
  const prefix = options.prefix ?? 'turnover:otp:'
  const now = options.clock ?? Date.now
  return {
    async get(identifier) {
      const raw = await client.get(prefix + identifier)
      return raw ? (JSON.parse(raw) as OtpRecord) : undefined
    },
    async set(identifier, record) {
      const key = prefix + identifier
      await client.set(key, JSON.stringify(record))
      const ttl = Math.max(1, Math.ceil((record.expiresAt - now()) / 1000))
      await client.expire(key, ttl)
    },
    async delete(identifier) {
      await client.del(prefix + identifier)
    },
  }
}

/** Options for {@link redisJobStore}. */
export interface RedisJobStoreOptions {
  /** Hash key the job set lives under (default `"turnover:jobs"`). */
  key?: string
}

/**
 * A {@link JobStore} backed by a single Redis hash — durable, shared background
 * jobs across replicas. Each job is a field in the hash; `due`/`failed`/`pending`
 * read the hash and filter in memory (like the in-memory default), and completed
 * jobs are removed so the hash doesn't grow without bound. Fine for modest job
 * volumes; a high-throughput queue wants a purpose-built broker.
 *
 * ```ts
 * const jobs = new JobQueue({ store: redisJobStore(redis) })
 * ```
 */
export function redisJobStore(
  client: RedisJobClient,
  options: RedisJobStoreOptions = {},
): JobStore {
  const key = options.key ?? 'turnover:jobs'
  const all = async (): Promise<Job[]> => {
    const map = await client.hgetall(key)
    return Object.values(map).map((raw) => JSON.parse(raw) as Job)
  }
  return {
    async add(job) {
      await client.hset(key, job.id, JSON.stringify(job))
    },
    async save(job) {
      // Completed jobs are done — drop them rather than accumulate.
      if (job.status === 'completed') {
        await client.hdel(key, job.id)
        return
      }
      await client.hset(key, job.id, JSON.stringify(job))
    },
    async due(now) {
      return (await all())
        .filter((job) => job.status === 'pending' && job.runAt <= now)
        .sort((a, b) => a.runAt - b.runAt)
    },
    async failed() {
      return (await all()).filter((job) => job.status === 'failed')
    },
    async pending() {
      return (await all()).filter((job) => job.status === 'pending').length
    },
  }
}
