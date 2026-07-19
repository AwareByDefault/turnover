---
"turnover": minor
---

Add `requestId()` — request correlation ids.

- **`requestId()`** is a plugin that gives every request a correlation id: it reuses an inbound `x-request-id` header (so an id set by a gateway or upstream service flows through) or mints one with `crypto.randomUUID()`, and echoes it on the response.
- **`getRequestId()`** reads the current request's id anywhere — handlers, injected services, and log lines — without threading a `ctx` through. The header name and generator are configurable via `RequestIdOptions`.
- Exposes `requestId`, `getRequestId`, `setRequestId`, and `RequestIdOptions`; adds an optional `requestId` field to `RequestState`.
