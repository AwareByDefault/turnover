import type { Plugin, ResponseHook } from './app'

/** Options for {@link securityHeaders}. Each header defaults on; `false` omits it. */
export interface SecurityHeadersOptions {
  /** `Content-Security-Policy`. Default `default-src 'self'`. */
  contentSecurityPolicy?: string | false
  /** `Strict-Transport-Security`. Default `max-age=15552000; includeSubDomains`. */
  strictTransportSecurity?: string | false
  /** `X-Frame-Options`. Default `DENY`. */
  frameOptions?: string | false
  /** `Referrer-Policy`. Default `no-referrer`. */
  referrerPolicy?: string | false
  /** `Cross-Origin-Opener-Policy`. Default `same-origin`. */
  crossOriginOpenerPolicy?: string | false
  /** `X-Content-Type-Options: nosniff`. Default `true`. */
  contentTypeOptions?: boolean
}

function buildHeaders(
  options: SecurityHeadersOptions,
): Array<[string, string]> {
  const headers: Array<[string, string]> = []
  const add = (
    name: string,
    value: string | false | undefined,
    fallback: string,
  ) => {
    const resolved = value === undefined ? fallback : value
    if (resolved !== false) headers.push([name, resolved])
  }
  add(
    'content-security-policy',
    options.contentSecurityPolicy,
    "default-src 'self'",
  )
  add(
    'strict-transport-security',
    options.strictTransportSecurity,
    'max-age=15552000; includeSubDomains',
  )
  add('x-frame-options', options.frameOptions, 'DENY')
  add('referrer-policy', options.referrerPolicy, 'no-referrer')
  add(
    'cross-origin-opener-policy',
    options.crossOriginOpenerPolicy,
    'same-origin',
  )
  if (options.contentTypeOptions !== false) {
    headers.push(['x-content-type-options', 'nosniff'])
  }
  return headers
}

/**
 * Plugin: set a baseline of security response headers (a helmet-style default) —
 * `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`,
 * `Referrer-Policy`, `Cross-Origin-Opener-Policy`, and `X-Content-Type-Options`.
 * Each is overridable, or `false` to omit it. Applied to every response without
 * clobbering a header a handler already set.
 *
 * ```ts
 * const app = await createApp({ plugins: [securityHeaders()] })
 * ```
 */
export function securityHeaders(options: SecurityHeadersOptions = {}): Plugin {
  const headers = buildHeaders(options)
  const onResponse: ResponseHook = (res) => {
    for (const [name, value] of headers) {
      if (!res.headers.has(name)) res.headers.set(name, value)
    }
    return res
  }
  return { onResponse }
}
