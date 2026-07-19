import type { Plugin } from './app'
import type { Principal } from './auth'
import type { Context, Interceptor } from './http'
import { setPrincipal } from './request'

/**
 * An authentication strategy: turns a request into a principal, or returns
 * `null` to defer to the next scheme. Implement one for any credential type.
 */
export interface AuthScheme {
  /** A label for diagnostics. */
  name: string
  authenticate(ctx: Context): Principal | null | Promise<Principal | null>
}

/**
 * Plugin: a baked-in authentication stage. On every request it runs the given
 * schemes in order; the first to resolve a principal wins and is attached to
 * the request (so `inject(Auth).user`, `@authenticated`, and `@requireRole`
 * see it). A request that no scheme recognises is simply anonymous.
 *
 * ```ts
 * const app = await createApp({
 *   plugins: [authentication([bearer({ verify }), apiKey({ verify })])],
 * })
 * ```
 */
export function authentication(schemes: AuthScheme[]): Plugin {
  const wrap: Interceptor = async (ctx, next) => {
    for (const scheme of schemes) {
      const principal = await scheme.authenticate(ctx)
      if (principal) {
        setPrincipal(principal)
        break
      }
    }
    return next()
  }
  return { wrap }
}

/** Options for the {@link bearer} scheme. */
export interface BearerOptions {
  /** Verify a token, returning the principal or `null` to reject it. */
  verify: (token: string) => Principal | null | Promise<Principal | null>
  /** Authorization scheme name. Default `Bearer`. */
  scheme?: string
}

/**
 * Authentication scheme: read `Authorization: Bearer <token>` and verify it.
 * Use it for JWTs, opaque access tokens, or anything carried as a bearer token.
 */
export function bearer(options: BearerOptions): AuthScheme {
  const prefix = `${options.scheme ?? 'Bearer'} `
  return {
    name: 'bearer',
    authenticate(ctx) {
      const header = ctx.req.headers.get('authorization')
      if (!header || !header.startsWith(prefix)) return null
      return options.verify(header.slice(prefix.length))
    },
  }
}

/** Options for the {@link apiKey} scheme. */
export interface ApiKeyOptions {
  /** Verify a key, returning the principal or `null` to reject it. */
  verify: (key: string) => Principal | null | Promise<Principal | null>
  /** Header carrying the key. Default `x-api-key`. */
  header?: string
}

/**
 * Authentication scheme: read an API key from a header (default `x-api-key`)
 * and verify it.
 */
export function apiKey(options: ApiKeyOptions): AuthScheme {
  const header = (options.header ?? 'x-api-key').toLowerCase()
  return {
    name: 'apiKey',
    authenticate(ctx) {
      const key = ctx.req.headers.get(header)
      return key ? options.verify(key) : null
    },
  }
}
