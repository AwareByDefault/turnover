/**
 * Request/response cookie access. `ctx.cookies` reads the incoming `Cookie`
 * header and collects outgoing `Set-Cookie`s, which the framework writes onto
 * the response.
 */

export interface CookieOptions {
  /** Restrict the cookie to a domain. */
  domain?: string
  /** Path scope (default `"/"`). */
  path?: string
  /** Absolute expiry. */
  expires?: Date
  /** Lifetime in seconds. */
  maxAge?: number
  /** Hide from client-side JS. */
  httpOnly?: boolean
  /** Only send over HTTPS. */
  secure?: boolean
  /** CSRF control. */
  sameSite?: 'strict' | 'lax' | 'none'
  /** Opt into partitioned (CHIPS) storage. */
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
   * @param name - The cookie name to read.
   * @returns The decoded cookie value, or `undefined` if not present.
   */
  get(name: string): string | undefined {
    return this.incoming.get(name)
  }

  /**
   * Whether an incoming cookie is present.
   *
   * @param name - The cookie name to check.
   * @returns `true` if the request sent a cookie with that name.
   */
  has(name: string): boolean {
    return this.incoming.has(name)
  }

  /**
   * All incoming cookies as a plain object.
   *
   * @returns A name→value map of every incoming cookie.
   */
  all(): Record<string, string> {
    return Object.fromEntries(this.incoming)
  }

  /**
   * Queue a cookie to be set on the response.
   *
   * @param name - The cookie name.
   * @param value - The cookie value (URL-encoded when serialized).
   * @param options - `Set-Cookie` attributes such as path, expiry, and flags.
   */
  set(name: string, value: string, options: CookieOptions = {}): void {
    this.outgoing.push(serializeCookie(name, value, options))
  }

  /**
   * Queue a cookie to be cleared (expired) on the response.
   *
   * @param name - The cookie name to clear.
   * @param options - Matching attributes (e.g. `path`, `domain`) so the browser drops the right cookie.
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
   * @returns The `Set-Cookie` header strings queued by `set`/`delete`.
   */
  serialize(): readonly string[] {
    return this.outgoing
  }
}
