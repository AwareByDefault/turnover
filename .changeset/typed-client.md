---
"turnover": minor
---

Add a minimal typed HTTP client (`createClient`).

- **`createClient<paths>(config)`** is a dependency-free typed client driven by an [`openapi-typescript`](https://github.com/openapi-ts/openapi-typescript)-generated `paths` type — the codegen-based end-to-end type safety, since standard decorators can't infer client types. Pipeline: dump `app.openapi()` → `openapi-typescript` → `createClient<paths>`.
- Typed `get`/`post`/`put`/`patch`/`delete`: path params, query, and body are typed and checked; the response `data` is typed per route; a non-2xx populates `error` instead. Options are required only when a route has path params or a body.
- `config.fetch` can override the fetch implementation — pass `app.handle` to drive an app in-memory. Exposes `createClient`, `Client`, `ClientConfig`, and `ClientResult`.
