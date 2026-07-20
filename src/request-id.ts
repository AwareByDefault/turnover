import type { Plugin } from './app'
import type { Interceptor } from './http'
import { setRequestId } from './request'

/** Options for the {@link requestId} plugin. */
export interface RequestIdOptions {
  /**
   * Header carrying the id on the request and echoed on the response.
   * Default `x-request-id`.
   */
  header?: string
  /** Generate an id when the request carries none. Default `crypto.randomUUID`. */
  generate?: () => string
}

/**
 * Plugin: give every request a correlation id. Reuses an inbound `x-request-id`
 * header (so an id set by a gateway or upstream service flows through) or mints
 * one, exposes it via {@link getRequestId} for handlers, services, and logs, and
 * echoes it on the response.
 *
 * ```ts
 * const app = await createApp({ plugins: [requestId()] })
 * // every response carries `x-request-id`; getRequestId() reads it anywhere
 * ```
 *
 * @param options - Header name and id generator overrides.
 * @returns A plugin that assigns and echoes a per-request correlation id.
 */
export function requestId(options: RequestIdOptions = {}): Plugin {
  const header = options.header ?? 'x-request-id'
  const generate = options.generate ?? (() => crypto.randomUUID())
  const wrap: Interceptor = async (ctx, next) => {
    const id = ctx.req.headers.get(header) ?? generate()
    setRequestId(id)
    const response = await next()
    response.headers.set(header, id)
    return response
  }
  return { wrap }
}
