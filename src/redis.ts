// Redis-backed adapters for turnover's async pluggable stores, so sessions and
// one-time codes survive restarts and are shared across replicas. Available at
// the `turnover/redis` subpath. Dependency-free: you pass in any client that
// satisfies the small `RedisClient` interface (Bun's built-in redis, ioredis,
// node-redis, …) — turnover never imports a Redis library.

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
