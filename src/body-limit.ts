import type { Plugin, RequestHook } from './app'

/**
 * Plugin: reject a request whose `Content-Length` exceeds `maxBytes` with
 * `413 Payload Too Large`, before the body is read. A cheap first-line guard
 * against oversized uploads. (Chunked requests that omit `Content-Length` pass
 * this check; enforce those in a streaming parser.)
 *
 * ```ts
 * const app = await createApp({ plugins: [bodyLimit(1_000_000)] }) // 1 MB
 * ```
 *
 * @param maxBytes - size ceiling in bytes; a request is rejected only when its
 *   `Content-Length` is strictly greater, so a body of exactly `maxBytes` passes
 * @returns a plugin whose request hook rejects oversized requests with `413`
 */
export function bodyLimit(maxBytes: number): Plugin {
  const onRequest: RequestHook = (req) => {
    const length = req.headers.get('content-length')
    if (length !== null && Number(length) > maxBytes) {
      return new Response('Payload Too Large', { status: 413 })
    }
  }
  return { onRequest }
}
