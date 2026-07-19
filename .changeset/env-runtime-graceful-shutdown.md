---
"turnover": minor
---

`app.listen()` reads the environment and shuts down gracefully.

- **`listen()`** now defaults the port to the `PORT` environment variable (then `3000`) and the bind address to `HOST`, so a container or platform can place the server without code changes. An explicit `listen(port)` still wins.
- By default it installs `SIGTERM`/`SIGINT` handlers that run `app.stop()` — draining in-flight requests, firing `onStop`, and disposing `@preDestroy` — then exit cleanly, so a deploy or `Ctrl+C` no longer drops requests. The handlers are removed on `stop()`, and can be disabled with `listen(port, { signals: false })`.
- Adds the `ListenOptions` type (`hostname`, `signals`).
