import type { Plugin } from './app'
import type { Interceptor } from './http'

/** Options for the {@link etag} plugin. */
export interface EtagOptions {
  /** Request methods that receive an ETag. Default `["GET"]`. */
  methods?: string[]
}

/**
 * Plugin: add a weak `ETag` to cacheable responses and answer `304 Not Modified`
 * when the client's `If-None-Match` matches — so an unchanged body costs a hash
 * and an empty response instead of re-sending it. Applies to `200` responses of
 * the configured methods (GET by default); other statuses are left untouched.
 *
 * ```ts
 * const app = await createApp({ plugins: [etag()] })
 * // GET /x → 200 + ETag; repeat with If-None-Match → 304
 * ```
 *
 * The body is buffered to hash it, so pair it with GET endpoints rather than
 * large streaming responses.
 *
 * @param options - which request methods receive an ETag (default `GET`)
 * @returns a plugin that adds weak ETags and answers `304 Not Modified`
 */
export function etag(options: EtagOptions = {}): Plugin {
  const methods = new Set(
    (options.methods ?? ['GET']).map((method) => method.toUpperCase()),
  )
  const wrap: Interceptor = async (ctx, next) => {
    const response = await next()
    if (
      !methods.has(ctx.req.method) ||
      response.status !== 200 ||
      !response.body
    ) {
      return response
    }
    const bytes = new Uint8Array(await response.clone().arrayBuffer())
    const tag = `W/"${bytes.length.toString(16)}-${Bun.hash(bytes).toString(16)}"`
    if (ctx.req.headers.get('if-none-match') === tag) {
      return new Response(null, { status: 304, headers: { etag: tag } })
    }
    response.headers.set('etag', tag)
    return response
  }
  return { wrap }
}
