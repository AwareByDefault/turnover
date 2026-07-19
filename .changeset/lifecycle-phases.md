---
"turnover": minor
---

Add `@resolve`, `onAfterResponse`, and `onTrace` lifecycle phases.

- **`@resolve(...)`** (controller or route) is like `@derive` but runs **after validation**, so it can read `ctx.valid` — e.g. load the entity named by a now-validated `:id` and put it on `ctx.store`. Order is now derivers → guards → validation → **resolvers** → handler.
- **`onAfterResponse(res, req)`** runs **fire-and-forget** after each response (including 404s/errors) so telemetry never delays the response.
- **`onTrace(event)`** reports each request's `{ req, response, durationMs }`.
- All three register via `createApp({ onAfterResponse, onTrace })` / `app.onAfterResponse()` / `app.onTrace()`, and `onAfterResponse`/`onTrace` via a `Plugin`. Exposes `resolve`, `AfterResponseHook`, `TraceHook`, and `TraceEvent`.
