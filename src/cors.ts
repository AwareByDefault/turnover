import type { Plugin, RequestHook, ResponseHook } from './app'

/** CORS configuration. Sensible permissive defaults; tighten `origin` for prod. */
export interface CorsOptions {
  /**
   * Allowed origin(s):
   * - `true` (default) reflects the request's `Origin`.
   * - a string sets it verbatim (e.g. `"*"` or `"https://app.example.com"`).
   * - an array or predicate reflects the origin only when it matches.
   * - `false` disables CORS headers.
   */
  origin?: string | string[] | boolean | ((origin: string) => boolean)
  /** Methods advertised in preflight responses. */
  methods?: string[]
  /** Allowed request headers; defaults to reflecting the preflight's request. */
  allowedHeaders?: string[]
  /** Response headers exposed to the browser. */
  exposedHeaders?: string[]
  /** Allow credentials (cookies/authorization). */
  credentials?: boolean
  /** Preflight cache lifetime, in seconds. */
  maxAge?: number
}

const DEFAULT_METHODS = [
  'GET',
  'HEAD',
  'PUT',
  'PATCH',
  'POST',
  'DELETE',
  'OPTIONS',
]

/** Resolve the `Access-Control-Allow-Origin` value for a request origin. */
function resolveOrigin(
  option: CorsOptions['origin'],
  requestOrigin: string,
): { value: string; vary: boolean } | null {
  if (option === false) return null
  if (option === undefined || option === true) {
    return { value: requestOrigin, vary: true }
  }
  if (typeof option === 'string') return { value: option, vary: option !== '*' }
  if (Array.isArray(option)) {
    return option.includes(requestOrigin)
      ? { value: requestOrigin, vary: true }
      : null
  }
  return option(requestOrigin) ? { value: requestOrigin, vary: true } : null
}

/**
 * A CORS plugin: handles preflight (`OPTIONS`) requests and adds CORS headers to
 * responses. Register it via `createApp({ plugins: [cors(...)] })` or
 * `app.register(cors(...))`.
 *
 * ```ts
 * const app = await createApp({
 *   controllers: [...],
 *   plugins: [cors({ origin: "https://app.example.com", credentials: true })],
 * });
 * ```
 */
export function cors(options: CorsOptions = {}): Plugin {
  const methods = (options.methods ?? DEFAULT_METHODS).join(', ')
  const exposed = options.exposedHeaders?.join(', ')
  const allowed = options.allowedHeaders?.join(', ')

  const onRequest: RequestHook = (req) => {
    const isPreflight =
      req.method === 'OPTIONS' &&
      req.headers.has('access-control-request-method')
    if (!isPreflight) return

    const headers = new Headers()
    const origin = req.headers.get('origin')
    if (origin) {
      const resolved = resolveOrigin(options.origin, origin)
      // Origin not allowed: answer the preflight without an Allow-Origin so the
      // browser blocks it.
      if (resolved) {
        headers.set('access-control-allow-origin', resolved.value)
        if (resolved.vary) headers.append('vary', 'Origin')
      }
    }
    headers.set('access-control-allow-methods', methods)
    const requestHeaders =
      allowed ?? req.headers.get('access-control-request-headers')
    if (requestHeaders)
      headers.set('access-control-allow-headers', requestHeaders)
    if (options.credentials)
      headers.set('access-control-allow-credentials', 'true')
    if (options.maxAge !== undefined) {
      headers.set('access-control-max-age', String(options.maxAge))
    }
    return new Response(null, { status: 204, headers })
  }

  const onResponse: ResponseHook = (res, req) => {
    if (res.headers.has('access-control-allow-origin')) return // already set
    const origin = req.headers.get('origin')
    if (!origin) return // not a cross-origin request
    const resolved = resolveOrigin(options.origin, origin)
    if (!resolved) return
    res.headers.set('access-control-allow-origin', resolved.value)
    if (resolved.vary) res.headers.append('vary', 'Origin')
    if (exposed) res.headers.set('access-control-expose-headers', exposed)
    if (options.credentials)
      res.headers.set('access-control-allow-credentials', 'true')
  }

  return { onRequest, onResponse }
}
