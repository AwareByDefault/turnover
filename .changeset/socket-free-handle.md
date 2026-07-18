---
"turnover": minor
---

Add `App.handle(request)` for socket-free request handling, and make it the single routing path.

- **New `app.handle(request)`** runs a `Request` through the full pipeline — routing, path-param capture, guards, DI, and response coercion — and returns a `Response` without opening a socket. Ideal for tests and offline tooling.
- **Unified routing.** `listen()` now serves through `handle()`, so an in-memory call behaves identically to a live request. `listen(port)` still returns Bun's `Server` (`.stop()`, `.port`, `.url`); pass `0` for an OS-assigned port. Unknown paths return `404`; unsupported methods return `405` with an `Allow` header.
- **`createApp({ controllers })` now mounts exactly the listed controllers** (isolated from anything else imported), instead of always mounting every `@controller` that has been registered globally.
- String handler return values now carry an explicit `text/plain;charset=utf-8` content-type, so `handle()` results match what `listen()` serves.
- Adds a `bun test` suite (`bun test`) covering routing, DI scopes, guards, request-scoped auth, and server lifecycle.
