---
"turnover": minor
---

Add pagination helpers — `pageParams` and `paginated`.

- **`pageParams(query, options?)`** reads `?page` (1-based) and `?limit` from a request's query string into normalized, clamped `{ page, limit, offset }` — invalid or missing values fall back to defaults, `limit` is bounded by `maxLimit` so a client can't request an unbounded page, and `offset` is ready for slicing or SQL `OFFSET`.
- **`paginated(data, total, params)`** wraps a page of results in a standard `{ data, page, limit, total, totalPages }` envelope.
- Exposes `pageParams`, `paginated`, `Page`, `PageParams`, and `PageOptions`.
