import type { Plugin } from './app'
import type { Interceptor } from './http'

/** Options for {@link compression}. */
export interface CompressionOptions {
  /** Minimum response size (bytes) to compress. Default 1024. */
  threshold?: number
  /** Extra content-type substrings to treat as compressible. */
  types?: string[]
}

const COMPRESSIBLE =
  /^(?:text\/|application\/(?:json|javascript|xml|.*\+json|.*\+xml))/i

function isCompressible(contentType: string, extra?: string[]): boolean {
  if (extra?.some((type) => contentType.includes(type))) return true
  return COMPRESSIBLE.test(contentType)
}

/**
 * Plugin: gzip-compress text-like responses when the client accepts it and the
 * body is worth compressing. Sets `Content-Encoding: gzip` and `Vary:
 * Accept-Encoding`; skips already-encoded, small, or non-text responses. The
 * body is buffered to compress it, so pair it with normal JSON/HTML responses
 * rather than large streams.
 *
 * ```ts
 * const app = await createApp({ plugins: [compression()] })
 * ```
 *
 * @param options - compression threshold and extra compressible content-types
 * @returns a plugin whose interceptor gzips eligible responses
 */
export function compression(options: CompressionOptions = {}): Plugin {
  const threshold = options.threshold ?? 1024
  const wrap: Interceptor = async (ctx, next) => {
    const res = await next()
    if (!res.body || res.headers.has('content-encoding')) return res
    if (!(ctx.req.headers.get('accept-encoding') ?? '').includes('gzip')) {
      return res
    }
    if (!isCompressible(res.headers.get('content-type') ?? '', options.types)) {
      return res
    }
    const body = new Uint8Array(await res.clone().arrayBuffer())
    if (body.length < threshold) return res
    const gzipped = Bun.gzipSync(body)
    const headers = new Headers(res.headers)
    headers.set('content-encoding', 'gzip')
    headers.set('content-length', String(gzipped.length))
    headers.set('vary', 'accept-encoding')
    return new Response(gzipped, { status: res.status, headers })
  }
  return { wrap }
}
