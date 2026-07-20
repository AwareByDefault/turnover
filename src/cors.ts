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
  /**
   * Sets `Access-Control-Allow-Methods` on preflight responses. Default:
   * `GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS`.
   */
  methods?: string[]
  /**
   * Sets `Access-Control-Allow-Headers` on preflight responses; when omitted,
   * reflects the request's `Access-Control-Request-Headers` verbatim.
   */
  allowedHeaders?: string[]
  /**
   * Sets `Access-Control-Expose-Headers` on actual (non-preflight) responses,
   * naming which response headers browser JS may read. Omitted, the header is
   * left off (only the CORS-safelisted response headers are readable).
   */
  exposedHeaders?: string[]
  /**
   * When `true`, sets `Access-Control-Allow-Credentials: true` on both preflight
   * and responses so the browser sends cookies / `Authorization`. Default
   * `false`. Incompatible with a wildcard `origin: "*"` — reflect a specific
   * origin instead, or the browser rejects the response.
   */
  credentials?: boolean
  /**
   * Seconds a browser may cache this preflight result (`Access-Control-Max-Age`).
   * Omitted, the header is left off and the browser uses its own short default.
   */
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
 *
 * @param options - CORS behavior; unset fields keep the permissive defaults
 *   (reflect the request `Origin`, standard method set, reflect requested
 *   headers, no credentials)
 * @returns a plugin that answers preflight requests and adds CORS response headers
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
