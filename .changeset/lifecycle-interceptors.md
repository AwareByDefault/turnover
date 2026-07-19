---
"turnover": minor
---

Add around-advice interceptors and app lifecycle hooks.

- **`@intercept(...)`** (controller or route) wraps a handler with around advice: an `Interceptor` receives `ctx` and a `next()` that runs the rest of the chain and returns its `Response`. Run code before/after, transform the response, short-circuit by skipping `next()`, or catch errors from it. Interceptors nest — controller-level wraps method-level, and a module's `intercept` wraps both. They run after guards, around validation and the handler. `@module` gains an `intercept` option.
- **Lifecycle hooks** — `onRequest(req)` runs before routing on every request (return a `Response` to short-circuit, e.g. CORS); `onStart(server)` runs once after `listen()`; `onStop()` runs on `app.stop()`, which then closes the server. Register via `createApp({ onRequest, onStart, onStop })` or `app.onRequest()` / `app.onStart()` / `app.onStop()`.
- Full per-request order: **onRequest → derivers → guards → interceptors → validation → handler → response**.
- Exposes `intercept`, `Interceptor`, `RequestHook`, `StartHook`, `StopHook`, and `App.stop()`.
