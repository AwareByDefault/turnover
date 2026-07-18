---
"turnover": minor
---

Add HTTP error types and a customizable error-handling pipeline.

- **`HttpError`** and named subclasses (`BadRequestError`, `UnauthorizedError`, `PaymentRequiredError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `GoneError`, `UnprocessableEntityError`, `TooManyRequestsError`, `InternalServerError`). Throw one from a handler or guard and it renders as a JSON envelope (`{ error: { message, code?, details? } }`) with the right status. Extend `HttpError` for domain errors.
- **Error handlers** map thrown values to responses. An `ErrorHandler` returns a `Response` to handle the error or nothing to defer to the next in the chain — **route → controller → global → framework default**. Register scoped handlers with the `@catchError(...)` decorator (class or method) and global handlers via `createApp({ onError })` or `app.onError(...)`.
- **Safe defaults**: a thrown value that isn't an `HttpError` becomes an opaque `500` (its message is never leaked to the client) and is logged; a thrown `Response` still passes through unchanged. `handle()` now always resolves to a `Response` — handler/guard errors no longer reject it.
- Unmatched routes (`404`) and unsupported methods (`405`, with an `Allow` header) now return the same JSON error envelope.
