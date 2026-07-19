---
"turnover": minor
---

Add `etag()` — HTTP caching with conditional requests.

- **`etag()`** is a plugin that attaches a weak `ETag` to cacheable responses and answers `304 Not Modified` when the client's `If-None-Match` matches — so an unchanged body costs a hash and an empty response instead of re-sending it.
- Applies to `200` responses of the configured methods (`GET` by default); other statuses and methods are left untouched. The tag is derived from the response body, so it is stable across identical responses. Distinct from `@cacheable`, which memoizes compute rather than transport.
- Exposes `etag` and `EtagOptions`.
