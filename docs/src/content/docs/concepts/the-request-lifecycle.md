---
title: The request lifecycle
description: The full ordered pipeline every request travels — hooks, routing, guards, interceptors, validation, the handler, and error handling.
sidebar:
  order: 4
---

Every request follows the same fixed pipeline. Understanding the order — and, crucially,
**where a `Response` can short-circuit** and **where errors are caught** — tells you exactly
which stages run for any given request. This page is the map the other concept pages hang off.

## The pipeline, step by step

1. **`onRequest` hooks** run first, **before routing**. Any hook that returns a `Response`
   short-circuits the rest of the pipeline (the response still flows out through the response
   stages below). This is where CORS and pre-routing logging live.
2. **Routing.** If a `delegate(prefix, handler)` owns the path, the request is handed off with
   the prefix stripped — the sub-app owns its whole prefix, including its own 404s. Otherwise
   Turnover matches the path: the static-route map first, then dynamic `:param` patterns.
   - No pattern matches → **`404`** (`{ "error": { "message": "No route for …" } }`).
   - The path matches but the method doesn't → **`405`** with an `Allow` header.
3. **The matched route runs inside request state** (an `AsyncLocalStorage` scope, so
   `getRequestState()` / request-scoped beans work), in this order:
   1. **`wrap` wrappers** — the **outermost** layer. They wrap everything below, including
      error handling, and see the final `Response` (even an error-converted `5xx`). The first
      registered is outermost.
   2. **Derivers** (`@derive`) populate `ctx.store` with per-request context.
   3. **Guards** (`@use`) run — authentication and authorization. A guard that returns **or
      throws** a `Response` short-circuits (a typical `401`/`403`).
   4. **Interceptors** (`@intercept`) wrap the handler core. Their "before" code runs here;
      each calls `next()` to descend. The first listed is outermost.
   5. **Input validation** — `params`, then `query`, then `body` schemas. A failure throws a
      **`422`** (caught at step 7).
   6. **Resolvers** (`@resolve`) run *after* validation, so they can read `ctx.valid`.
   7. **The handler** runs and returns a value.
   8. **Response building** — response-schema validation (if declared; a mismatch is a server
      bug → opaque **`500`**), then custom serializers, then the default coercion (Response
      passthrough / `string` → text / `null` → `204` / else JSON).
   9. **Interceptors ("after")** — the code after each interceptor's `next()` unwinds here.
   10. **Error conversion.** A thrown `Response` passes through unchanged; any other throw runs
       the `@catchError` → global → default chain and becomes a `Response`. This is inside
       `wrap`, so wrappers see the converted response.
   11. **Outgoing merge** — `ctx.set.headers` and queued `Set-Cookie`s are applied.
4. Back in the top-level handler, on the produced `Response`:
   1. **`onResponse` hooks** run for **every** response (including 404s and errors) and may
      **replace** it.
   2. **`onTrace` hooks** receive each request's total `durationMs`.
   3. **`onAfterResponse` hooks** run **fire-and-forget** — they never delay the response
      (metrics, logging).

## The pipeline, as a diagram

```text
 Request
    │
    ▼
┌─ onRequest hooks ──────────────── returns Response? ─┐  (short-circuit → onResponse)
    │
    ▼
 delegate match?  ── yes ─▶ sub-app (prefix stripped, owns its 404s)
    │ no
    ▼
 route match ─── none ─▶ 404 ─── wrong method ─▶ 405 (Allow)
    │ matched
    ▼
╔═ wrap (OUTERMOST — sees the final Response, incl. 5xx) ══════════════════╗
║   ┌─ error boundary (catch) ─────────────────────────────────────────┐  ║
║   │  derivers  (@derive → ctx.store)                                  │  ║
║   │  guards    (@use)  ── returns/throws Response? ─▶ short-circuit ──┤  ║
║   │  ┌─ interceptors (@intercept) ── skip next()? ─▶ short-circuit ─┐ │  ║
║   │  │   validation (params → query → body)   ── invalid ─▶ throw 422│ │  ║
║   │  │   resolvers  (@resolve, reads ctx.valid)                     │ │  ║
║   │  │   handler                                                    │ │  ║
║   │  │   response validation → serializers → coercion               │ │  ║
║   │  └──────────────────────── (interceptors "after" unwind) ───────┘ │  ║
║   └──── throw (not a Response) ─▶ @catchError → global → default ──────┘  ║
║   apply ctx.set.headers + queued cookies                                 ║
╚══════════════════════════════════════════════════════════════════════════╝
    │
    ▼
 onResponse hooks (may replace)  →  onTrace (timing)  →  onAfterResponse (fire-and-forget)
    │
    ▼
 Response
```

## Scoping: module → controller → route

Guards, derivers, and interceptors can be attached at three levels, and they run
**broadest-first**: a module's apply before a controller's, which apply before a single
route's.

```text
guards / derivers / interceptors :  module  →  controller  →  route
```

Error handlers run in the opposite order — **most-specific first**:

```text
@catchError chain :  route  →  controller  →  module  →  global (onError)  →  framework default
```

Within a scope, the first handler to return a `Response` wins; a handler that itself throws
stops the chain and its error is rendered instead. See [Error handling](/concepts/error-handling/).

## `wrap` vs `@intercept`

Both wrap around code, but at different radii:

| | `wrap` (`App.wrap`, `createApp({ wrap })`, a plugin's `wrap`) | `@intercept` |
| --- | --- | --- |
| Radius | **Outermost** — around guards, the handler, **and** error handling | Around the **handler core** only (validation → resolvers → handler → coercion) |
| Runs relative to guards | Before guards | **After** guards |
| Sees error-converted 5xx | **Yes** — it sees the final `Response` | No — an error inside is thrown past it to the error chain |
| Typical use | Establish per-request ambient context (e.g. an OpenTelemetry server span the handler's spans nest under) | Cross-cutting logic around a specific handler (timing a route, caching) |

```ts
// wrap: sees the final Response, including a 500 the handler triggered.
app.wrap(async (ctx, next) => {
  const res = await next();
  console.log(ctx.route, res.status); // e.g. "/users/:id 500"
  return res;
});
```

Because interceptors sit *inside* the guards, a request rejected by a guard never reaches your
`@intercept` logic — but a `wrap` wrapper still runs and still observes the `401`.

## Next steps

- [Guards & auth](/concepts/guards-and-auth/) — the `@use` guard stage and how it short-circuits.
- [Validation](/concepts/validation/) — the validation stage and its `422` failures.
- [Interceptors](/concepts/interceptors/) — the `@intercept` around-advice layer.
- [Deriving context](/concepts/deriving-context/) — `@derive` and `@resolve` populating `ctx.store`.
- [Lifecycle hooks & plugins](/concepts/lifecycle-hooks-and-plugins/) — `onRequest`/`onResponse`/`wrap` and bundling them.
- [Error handling](/concepts/error-handling/) — the `@catchError` chain and default rendering.
