---
"turnover": minor
---

Add `problemDetails()` — RFC 9457 error responses.

- **`problemDetails()`** is a plugin that renders errors as [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json` instead of the default JSON envelope. An `HttpError` becomes a problem document with its `status`, a `title`, the message as `detail`, the request path as `instance`, and any `code`/`details` as extension members; an unknown error becomes an opaque `500` whose message is never leaked.
- Opt-in via `plugins: [problemDetails()]`, so existing error shapes are unchanged until you add it. Exposes `problemDetails` and the `ProblemDocument` type.
