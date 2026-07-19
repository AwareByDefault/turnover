import type { Plugin } from './app'
import type { Context, Interceptor } from './http'

/** A rate-limit counter store: record a hit, report the count + reset time. */
export interface RateLimitStore {
  hit(
    key: string,
    windowMs: number,
  ):
    | { count: number; resetMs: number }
    | Promise<{ count: number; resetMs: number }>
}

/** In-memory fixed-window counter (per key) — the default store. */
export function memoryRateLimitStore(): RateLimitStore {
  const windows = new Map<string, { count: number; expires: number }>()
  return {
    hit(key, windowMs) {
      const now = Date.now()
      let window = windows.get(key)
      if (!window || window.expires <= now) {
        window = { count: 0, expires: now + windowMs }
        windows.set(key, window)
      }
      window.count += 1
      return { count: window.count, resetMs: window.expires - now }
    },
  }
}

/** Options for {@link rateLimit}. */
export interface RateLimitOptions {
  /** Max requests allowed per window. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
  /** Bucket key for a request. Default: the `X-Forwarded-For` header, else `"global"`. */
  keyBy?: (ctx: Context) => string
  /** Counter store. Default: an in-memory fixed window. */
  store?: RateLimitStore
}

/**
 * Plugin: limit how many requests a client may make in a time window, replying
 * `429 Too Many Requests` (with `Retry-After`) once the limit is exceeded. Every
 * response carries `X-RateLimit-Limit`/`X-RateLimit-Remaining`. Bucket clients
 * with `keyBy` (default: the `X-Forwarded-For` header); swap the in-memory
 * counter for a shared `store` (e.g. Redis) in a multi-instance deployment.
 *
 * ```ts
 * const app = await createApp({
 *   plugins: [rateLimit({ limit: 100, windowMs: 60_000 })],
 * })
 * ```
 */
export function rateLimit(options: RateLimitOptions): Plugin {
  const store = options.store ?? memoryRateLimitStore()
  const keyBy =
    options.keyBy ??
    ((ctx: Context) => ctx.req.headers.get('x-forwarded-for') ?? 'global')

  const wrap: Interceptor = async (ctx, next) => {
    const { count, resetMs } = await store.hit(keyBy(ctx), options.windowMs)
    if (count > options.limit) {
      return new Response('Too Many Requests', {
        status: 429,
        headers: {
          'retry-after': String(Math.ceil(resetMs / 1000)),
          'x-ratelimit-limit': String(options.limit),
          'x-ratelimit-remaining': '0',
        },
      })
    }
    const res = await next()
    res.headers.set('x-ratelimit-limit', String(options.limit))
    res.headers.set(
      'x-ratelimit-remaining',
      String(Math.max(0, options.limit - count)),
    )
    return res
  }
  return { wrap }
}
