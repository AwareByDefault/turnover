import type { Plugin } from './app'
import { HttpError } from './error'
import type { ErrorHandler } from './http'

/** An [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem document. */
export interface ProblemDocument {
  /** A URI identifying the problem type. `about:blank` when unspecified. */
  type: string
  /** A short, human-readable summary of the problem type. */
  title: string
  /** The HTTP status code. */
  status: number
  /** A human-readable explanation specific to this occurrence. */
  detail?: string
  /** A URI reference identifying the specific occurrence (the request path). */
  instance?: string
  /** Extension members (e.g. a machine-readable `code`). */
  [key: string]: unknown
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
}

function titleFor(status: number): string {
  return TITLES[status] ?? `HTTP ${status}`
}

function problemResponse(problem: ProblemDocument): Response {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: { 'content-type': 'application/problem+json' },
  })
}

/**
 * Plugin: render errors as [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)
 * `application/problem+json` instead of the default JSON envelope. An
 * `HttpError` becomes a problem document carrying its status, a title, the
 * message as `detail`, the request path as `instance`, and any `code`/`details`
 * as extension members; an unknown error becomes an opaque `500` whose message
 * is never leaked. Opt-in, so existing error shapes are unchanged until added.
 *
 * ```ts
 * const app = await createApp({ plugins: [problemDetails()] })
 * // throw new NotFoundError("user 5") → 404 application/problem+json
 * ```
 *
 * @returns a plugin whose error handler renders `application/problem+json`
 */
export function problemDetails(): Plugin {
  const onError: ErrorHandler = (err, ctx) => {
    // A thrown Response is intentional — let it pass through unchanged.
    if (err instanceof Response) return undefined
    const instance = new URL(ctx.req.url).pathname
    if (err instanceof HttpError) {
      return problemResponse({
        type: 'about:blank',
        title: titleFor(err.status),
        status: err.status,
        detail: err.message,
        instance,
        ...(err.code ? { code: err.code } : {}),
        ...(err.details !== undefined ? { details: err.details } : {}),
      })
    }
    // Unknown error → opaque 500; the message is not leaked to the client.
    return problemResponse({
      type: 'about:blank',
      title: titleFor(500),
      status: 500,
      instance,
    })
  }
  return { onError }
}
