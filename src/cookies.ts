/**
 * Request/response cookie access. `ctx.cookies` reads the incoming `Cookie`
 * header and collects outgoing `Set-Cookie`s, which the framework writes onto
 * the response.
 */

/**
 * `Set-Cookie` attributes passed to {@link Cookies.set}. Every field is
 * optional; unset flags are simply omitted from the emitted header (only `Path`
 * is always written, defaulting to `/`).
 */
export interface CookieOptions {
  /** Send the cookie to this domain and its subdomains; omit to scope it to the exact response host. */
  domain?: string
  /** URL-path prefix the cookie is scoped to; always emitted, defaulting to `/` (whole site). */
  path?: string
  /** Absolute expiry, serialized as an HTTP date; a past date deletes the cookie. Browsers prefer `maxAge` when both are set. */
  expires?: Date
  /** Lifetime in seconds, floored to an integer; `0` or a negative value expires the cookie immediately. */
  maxAge?: number
  /** Emit `HttpOnly` so client-side JS (`document.cookie`) can't read the cookie — mitigates token theft via XSS. */
  httpOnly?: boolean
  /** Emit `Secure` so the cookie is sent only over HTTPS; required by browsers when `sameSite` is `'none'`. */
  secure?: boolean
  /** Cross-site send policy (`SameSite`): `'lax'` sends on top-level navigations, `'strict'` never cross-site, `'none'` always (needs `secure`). Serialized capitalized. */
  sameSite?: 'strict' | 'lax' | 'none'
  /** Emit `Partitioned` (CHIPS): key the cookie to the current top-level site rather than sharing it cross-site; requires `secure`. */
  partitioned?: boolean
}

/** Parse a `Cookie` request header into a name→value map (values decoded). */
function parseCookieHeader(header: string | null): Map<string, string> {
  const map = new Map<string, string>()
  if (!header) return map
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    const name = pair.slice(0, eq).trim()
    if (!name) continue
    const value = pair.slice(eq + 1).trim()
    try {
      map.set(name, decodeURIComponent(value))
    } catch {
      map.set(name, value)
    }
  }
  return map
}

/** Serialize one cookie into a `Set-Cookie` header value. */
function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions,
): string {
  let out = `${name}=${encodeURIComponent(value)}`
  if (options.maxAge !== undefined)
    out += `; Max-Age=${Math.floor(options.maxAge)}`
  if (options.domain) out += `; Domain=${options.domain}`
  out += `; Path=${options.path ?? '/'}`
  if (options.expires) out += `; Expires=${options.expires.toUTCString()}`
  if (options.httpOnly) out += '; HttpOnly'
  if (options.secure) out += '; Secure'
  if (options.sameSite) {
    const s = options.sameSite
    out += `; SameSite=${s.charAt(0).toUpperCase()}${s.slice(1)}`
  }
  if (options.partitioned) out += '; Partitioned'
  return out
}

/**
 * The cookie jar for one request. Reads are backed by the incoming `Cookie`
 * header; writes queue `Set-Cookie` headers applied to the response.
 */
export class Cookies {
  private readonly incoming: Map<string, string>
  private readonly outgoing: string[] = []

  /** Build a jar from the incoming request's `Cookie` header (may be `null`). */
  constructor(cookieHeader: string | null) {
    this.incoming = parseCookieHeader(cookieHeader)
  }

  /**
   * The value of an incoming cookie, or `undefined`.
   *
   * @param name - matched case-sensitively against the request's `Cookie` header only; cookies queued via {@link Cookies.set} are not visible here.
   * @returns The decoded cookie value, or `undefined` if not present.
   */
  get(name: string): string | undefined {
    return this.incoming.get(name)
  }

  /**
   * Whether an incoming cookie is present.
   *
   * @param name - checked against incoming (request) cookies only, not pending writes.
   * @returns `true` if the request sent a cookie with that name.
   */
  has(name: string): boolean {
    return this.incoming.has(name)
  }

  /**
   * All incoming cookies as a plain object.
   *
   * @returns A fresh name→value object of every incoming cookie, values already URL-decoded.
   */
  all(): Record<string, string> {
    return Object.fromEntries(this.incoming)
  }

  /**
   * Queue a cookie to be set on the response. Each call appends a distinct
   * `Set-Cookie`; queuing the same name twice emits two headers (no dedupe).
   *
   * @param name - the cookie name (written verbatim, not encoded).
   * @param value - the cookie value; URL-encoded when serialized.
   * @param options - `Set-Cookie` attributes and flags; see {@link CookieOptions} (`path` defaults to `/`).
   */
  set(name: string, value: string, options: CookieOptions = {}): void {
    this.outgoing.push(serializeCookie(name, value, options))
  }

  /**
   * Queue a cookie to be cleared on the response — emits it with an empty
   * value, `Max-Age=0`, and a 1970 `Expires` so the browser drops it.
   *
   * @param name - the cookie name to clear.
   * @param options - `path`/`domain` etc. must match how the cookie was set, or the browser keeps it; `expires`/`maxAge` are excluded since they're set here.
   */
  delete(
    name: string,
    options: Omit<CookieOptions, 'expires' | 'maxAge'> = {},
  ): void {
    this.outgoing.push(
      serializeCookie(name, '', {
        ...options,
        expires: new Date(0),
        maxAge: 0,
      }),
    )
  }

  /**
   * The queued `Set-Cookie` header values.
   *
   * @returns the queued `Set-Cookie` values in insertion order (one per `set`/`delete` call); the framework writes each as its own response header.
   */
  serialize(): readonly string[] {
    return this.outgoing
  }
}
