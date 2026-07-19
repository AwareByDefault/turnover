/**
 * HTTP-aware error types and the default error renderer.
 *
 * Throw an `HttpError` (or one of its named subclasses) from a handler or guard
 * and the framework turns it into a JSON response with the right status. Anything
 * that isn't an `HttpError` becomes a `500`. Register an error handler
 * (`@catchError` / `createApp({ onError })`) to customize any of this.
 */

export interface HttpErrorOptions {
  /** A stable, machine-readable error code (e.g. `"user_not_found"`). */
  code?: string
  /** Extra structured data to include in the response body. */
  details?: unknown
  /** The underlying error, for logging/`cause` chaining. */
  cause?: unknown
}

/** The JSON body shape produced for an error response. */
export interface ErrorBody {
  error: {
    message: string
    code?: string
    details?: unknown
  }
}

/**
 * An error carrying an HTTP status. Throw it from a handler/guard to short-circuit
 * with that status; the framework renders it via {@link HttpError.toResponse}.
 * Extend it for domain errors, or throw `new HttpError(status, message)` directly.
 */
export class HttpError extends Error {
  readonly status: number
  readonly code?: string
  readonly details?: unknown

  constructor(
    status: number,
    message?: string,
    options: HttpErrorOptions = {},
  ) {
    super(message ?? `HTTP ${status}`, { cause: options.cause })
    // Use the concrete subclass name (e.g. "NotFoundError") for `.name`.
    this.name = new.target.name
    this.status = status
    this.code = options.code
    this.details = options.details
  }

  /** Render this error as a JSON `Response` with its status. */
  toResponse(): Response {
    const error: ErrorBody['error'] = { message: this.message }
    if (this.code !== undefined) error.code = this.code
    if (this.details !== undefined) error.details = this.details
    return Response.json({ error } satisfies ErrorBody, { status: this.status })
  }
}

/** Build a named `HttpError` subclass for a fixed status + default message. */
function httpError(status: number, defaultMessage: string) {
  return class extends HttpError {
    constructor(message: string = defaultMessage, options?: HttpErrorOptions) {
      super(status, message, options)
    }
  }
}

/** `400 Bad Request` */
export const BadRequestError = httpError(400, 'Bad Request')
/** `401 Unauthorized` */
export const UnauthorizedError = httpError(401, 'Unauthorized')
/** `402 Payment Required` */
export const PaymentRequiredError = httpError(402, 'Payment Required')
/** `403 Forbidden` */
export const ForbiddenError = httpError(403, 'Forbidden')
/** `404 Not Found` */
export const NotFoundError = httpError(404, 'Not Found')
/** `409 Conflict` */
export const ConflictError = httpError(409, 'Conflict')
/** `410 Gone` */
export const GoneError = httpError(410, 'Gone')
/** `422 Unprocessable Entity` (e.g. validation failures) */
export const UnprocessableEntityError = httpError(422, 'Unprocessable Entity')
/** `429 Too Many Requests` */
export const TooManyRequestsError = httpError(429, 'Too Many Requests')
/** `500 Internal Server Error` */
export const InternalServerError = httpError(500, 'Internal Server Error')

/**
 * The default rendering for an unhandled thrown value: an `HttpError` (or a
 * subclass) becomes its `toResponse()`, a thrown `Response` passes through, and
 * anything else becomes an opaque `500` (its message is not leaked to the client).
 */
export function toErrorResponse(err: unknown): Response {
  if (err instanceof Response) return err
  if (err instanceof HttpError) return err.toResponse()
  return Response.json(
    { error: { message: 'Internal Server Error' } } satisfies ErrorBody,
    {
      status: 500,
    },
  )
}
