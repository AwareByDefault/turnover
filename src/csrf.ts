import type { Plugin } from './app'
import type { CookieOptions } from './cookies'
import type { Interceptor } from './http'

/** Options for {@link csrf}. */
export interface CsrfOptions {
  /** Cookie holding the CSRF token. Default `"csrf-token"`. */
  cookie?: string
  /** Request header that must echo the token on unsafe requests. Default `"x-csrf-token"`. */
  header?: string
  /** Methods that need no token and mint one if absent. Default `GET`/`HEAD`/`OPTIONS`. */
  safeMethods?: string[]
  /**
   * Cookie attributes for the minted token. Defaults to `SameSite=Strict` and
   * `Path=/`. The cookie is deliberately readable by client JS (not `HttpOnly`)
   * so the page can echo it into {@link CsrfOptions.header}.
   */
  cookieOptions?: CookieOptions
}

/**
 * Plugin: CSRF protection via the double-submit-cookie pattern. On a safe
 * request (`GET`/`HEAD`/`OPTIONS`) it mints a random token cookie if absent; on
 * an unsafe request it requires a header whose value matches that cookie,
 * replying `403 Forbidden` otherwise. The guarantee rests on the same-origin
 * policy: a cross-site attacker can neither read the cookie to forge the header
 * nor set the custom header without a (blocked) preflight. Pair it with
 * `SameSite` cookies (the default here) for defence in depth.
 *
 * ```ts
 * const app = await createApp({ plugins: [csrf()] })
 * // Browser: read the `csrf-token` cookie, send it as `x-csrf-token` on writes.
 * ```
 */
export function csrf(options: CsrfOptions = {}): Plugin {
  const cookieName = options.cookie ?? 'csrf-token'
  const headerName = options.header ?? 'x-csrf-token'
  const safe = new Set(
    (options.safeMethods ?? ['GET', 'HEAD', 'OPTIONS']).map((m) =>
      m.toUpperCase(),
    ),
  )
  const cookieOptions: CookieOptions = {
    sameSite: 'strict',
    path: '/',
    ...options.cookieOptions,
  }
  const wrap: Interceptor = (ctx, next) => {
    const token = ctx.cookies.get(cookieName)
    if (safe.has(ctx.req.method)) {
      // Mint a token on first contact so the client can echo it back on writes.
      if (!token) {
        ctx.cookies.set(cookieName, crypto.randomUUID(), cookieOptions)
      }
      return next()
    }
    const sent = ctx.req.headers.get(headerName)
    if (!token || !sent || token !== sent) {
      return new Response('Forbidden', { status: 403 })
    }
    return next()
  }
  return { wrap }
}
