---
"turnover": minor
---

Add an `onResponse` hook, a plugin mechanism, and a built-in CORS plugin.

- **`onResponse(res, req)`** runs after every response (including 404s and errors) and may return a `Response` to replace it or mutate its headers. Register via `createApp({ onResponse })` or `app.onResponse()`. Full per-request order is now **onRequest → derivers → guards → interceptors → validation → handler → onResponse → response**.
- **Plugins** — a `Plugin` is a bundle of hooks (`onRequest`/`onResponse`/`onStart`/`onStop`/`onError`). Register with `app.register(plugin)` or `createApp({ plugins: [...] })`.
- **`cors(options)`** — a built-in plugin that answers preflight `OPTIONS` requests and adds CORS headers to responses. `origin` accepts `true` (reflect, default), a string (`"*"` or fixed), an array/predicate (reflect on match), or `false`; plus `methods`, `allowedHeaders`, `exposedHeaders`, `credentials`, and `maxAge`.
- Exposes `ResponseHook`, `Plugin`, `App.onResponse`, `App.register`, `cors`, and `CorsOptions`.
