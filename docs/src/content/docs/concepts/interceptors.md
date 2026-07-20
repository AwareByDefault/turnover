---
title: Interceptors
description: Wrap a route handler with around-advice — run code before and after in one place, transform the response, short-circuit, or catch errors.
sidebar:
  order: 11
---

An **interceptor** wraps a route handler. It runs code *before and after* the
handler in one place, and can transform the response, short-circuit before the
handler ever runs, or catch what the handler throws. You attach one with
`@intercept(...)` on a controller (every route) or on a single route.

```ts title="things.controller.ts"
import { controller, get, intercept, type Interceptor } from "turnover";

const timing: Interceptor = async (ctx, next) => {
  const started = performance.now();
  const res = await next(); // run the rest of the chain (validation + handler)
  res.headers.set("x-response-time", `${performance.now() - started}ms`);
  return res; // the transformed response
};

@controller("/things")
@intercept(timing) // wraps every route in this controller
export class ThingsController {
  @get("/")
  list() {
    return { things: [] };
  }
}
```

```bash
curl -i http://localhost:3000/things
# => 200 OK
# => x-response-time: 0.42ms
# => {"things":[]}
```

## The `Interceptor` signature

An interceptor is a function of `(ctx, next)`:

```ts title="interceptor.ts"
type Interceptor = (
  ctx: Context,
  next: () => Promise<Response>,
) => Response | Promise<Response>;
```

- `ctx` is the same per-request [`Context`](/concepts/the-request-lifecycle/)
  the handler receives — read `ctx.req`, `ctx.params`, `ctx.valid`, mutate
  `ctx.set`, and so on.
- `next()` runs **the rest of the chain** (inner interceptors, then input
  validation, resolvers, the handler, and response coercion) and resolves to the
  `Response` that chain produced.

Whatever the interceptor returns becomes the response for that layer. This gives
you four moves:

- **Run before.** Do work, then call `next()`.
- **Run after / transform.** `await next()`, then read or mutate the returned
  `Response` (or build a new one) before returning it.
- **Short-circuit.** Skip `next()` entirely and return your own `Response` — the
  handler never runs.
- **Catch.** Wrap `next()` in `try/catch` to handle what the handler throws.

```ts title="short-circuit-and-catch.ts"
// Short-circuit: never reach the handler.
const featureFlag: Interceptor = (ctx, next) =>
  flags.enabled("beta") ? next() : new Response("Not available", { status: 404 });

// Catch: turn a thrown error into a fallback response.
const fallback: Interceptor = async (ctx, next) => {
  try {
    return await next();
  } catch {
    return Response.json({ items: [] }, { status: 200 });
  }
};
```

:::note
`next()` returns the handler's **coerced** `Response` — after return-value
coercion, custom serializers, and response-schema validation have run. Read
[Parsing & serialization](/concepts/parsing-and-serialization/) for what that
final `Response` looks like.
:::

## Nesting

Interceptors nest, outermost first. When several layers apply to the same route,
the order is **module → controller → route**, and the first one listed is the
outermost — its `next()` wraps everything more specific.

```ts title="nesting.ts"
@controller("/things")
@intercept(timing) // outer: wraps the whole route
export class ThingsController {
  @get("/")
  @intercept(cacheFor(60)) // inner: wraps only this handler
  list() {
    return { things: [] };
  }
}
```

Here `timing` sees the response `cacheFor(60)` produced, which in turn wraps the
handler. A [module](/concepts/modules/)'s `intercept` list wraps both the
controller and route interceptors, since it is broader still.

## Where interceptors run

Interceptors run **after guards** and wrap only the handler side of the request:
input validation, resolvers, the handler, and response coercion. They do *not*
wrap the guards, and they do *not* wrap the framework's error-to-`Response`
conversion — if your interceptor lets a thrown error propagate, it is converted
by the `@catchError` chain *outside* the interceptors.

```
guards → [ interceptors → validation → resolvers → handler → coercion ] → error conversion
```

See [The request lifecycle](/concepts/the-request-lifecycle/) for the full order.

## Interceptors vs. `wrap`

`@intercept` wraps only the handler, and only after guards have passed. To wrap
the **entire** request — guards, the handler, *and* error handling — and see the
final `Response` (including an error-converted 5xx), use a `wrap` wrapper
instead. `wrap` is the outermost layer and the right place to establish
per-request ambient context (an OpenTelemetry span, a logging scope). A `wrap`
wrapper has the same `(ctx, next)` shape as an interceptor but a wider reach —
see [Lifecycle hooks & plugins](/concepts/lifecycle-hooks-and-plugins/).

## Next steps

- [The request lifecycle](/concepts/the-request-lifecycle/) — where interceptors
  sit in the full per-request order.
- [Method advice](/concepts/method-advice/) — `@before` / `@after` / `@around`
  for wrapping *any* service method, not just handlers.
- [Lifecycle hooks & plugins](/concepts/lifecycle-hooks-and-plugins/) — `wrap`,
  the outermost per-request wrapper, and how it differs.
