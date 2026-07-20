---
title: Lifecycle hooks & plugins
description: App-wide hooks that fire around requests and the server lifecycle, how to bundle them into a plugin, and wrap — the outermost per-request wrapper.
sidebar:
  order: 17
---

Beyond per-route [guards](/concepts/guards-and-auth/) and
[interceptors](/concepts/interceptors/), Turnover exposes **app-wide hooks** that
fire around every request and around the server's own start/stop. Bundle a set of
these hooks together and you have a **plugin**. And for the outermost wrapping of
a request — around guards, the handler, *and* error handling — there is `wrap`.

## Request & response hooks

Register hooks on `createApp(...)` or by calling the matching method on the app:

```ts title="server.ts"
import { createApp } from "turnover";

const app = await createApp({
  controllers: [UsersController],
  onRequest: [(req) => { /* pre-routing */ }],
  onStart: [(server) => console.log(`up on ${server.url}`)],
  onStop: [() => db.close()],
});
const server = app.listen(3000);
// ...later: await app.stop();
```

- **`onRequest(req)`** runs **before routing**, on every request. Return a
  `Response` to short-circuit (CORS preflight, a maintenance page, an early
  reject); return nothing to continue to routing.
- **`onResponse(res, req)`** runs after a response is produced — including 404s
  and errors. Return a `Response` to **replace** it, or mutate its headers in
  place and return nothing to keep it.
- **`onAfterResponse(res, req)`** runs **fire-and-forget** after the response has
  been produced; it never delays delivery. Use it for metrics and logging.
- **`onTrace(event)`** runs fire-and-forget with a `TraceEvent` carrying the
  `req`, the `response`, and the total `durationMs` for the request — ideal for
  latency metrics.

```ts title="hooks.ts"
app.onResponse((res) => {
  res.headers.set("x-app", "turnover");
});

app.onTrace((event) => {
  metrics.observe(event.durationMs);
});
```

Multiple hooks of the same kind run in registration order.

## Server lifecycle hooks

- **`onStart(server)`** runs once, after `listen()` has started the server. It
  receives Bun's `Server` (with `.url`, `.port`, `.stop()`).
- **`onStop()`** runs once when the app is stopping, **before** the server
  closes — the place to flush buffers or close database connections.

`app.stop()` runs the `onStop` hooks, then stops the server, then runs any
`@preDestroy` teardown on your services.

## Plugins

A **plugin** is just a bundle of these hooks (plus, optionally, body parsers,
serializers, an error handler, and a `wrap`). Register one with
`app.register(plugin)` or `createApp({ plugins: [...] })`:

```ts title="app-header.plugin.ts"
import type { Plugin } from "turnover";

export const appHeader: Plugin = {
  onResponse: (res) => {
    res.headers.set("x-powered-by", "turnover");
  },
};
```

```ts title="server.ts"
const app = await createApp({ plugins: [appHeader] });
// or: app.register(appHeader);
```

This is the shape returned by built-in plugins like `cors(...)` and the
OpenTelemetry integration. A plugin may also define an `onInit(container)` hook,
which runs once at registration time with the app's container — the place to
resolve DI-registered collaborators before requests start.

## `wrap`: the outermost per-request wrapper

`wrap` registers a wrapper with the same `(ctx, next)` shape as an
[interceptor](/concepts/interceptors/), but the widest possible reach for a
routed request. It is the **outermost** layer — it runs around the derivers,
guards, the handler, **and** the error handling, and it sees the **final**
`Response`, including one that was error-converted into a 5xx.

```ts title="request-context.ts"
import type { Interceptor } from "turnover";

const requestContext: Interceptor = async (ctx, next) => {
  return runWithAmbientContext({ route: ctx.route }, async () => {
    return await next(); // guards + handler + error handling all run inside here
  });
};
```

Register it three ways — on `createApp`, on the app, or via a plugin:

```ts title="server.ts"
const app = await createApp({ wrap: [requestContext] });
// or: app.wrap(requestContext);
// or: a plugin with a `wrap` field
```

Because `wrap` establishes an ambient scope that everything downstream runs
inside, it is the right place to open a per-request context — a logging scope, or
an OpenTelemetry server span that the handler's own spans nest under. That is
exactly what the [OpenTelemetry plugin](/guides/opentelemetry/) uses. When
several wrappers are registered, the first one is the outermost.

:::note[`wrap` vs. `@intercept`]
`@intercept` wraps only the handler, and only *after* guards have passed; a
thrown error escapes it and is converted by the `@catchError` chain outside. A
`wrap` wrapper encloses the guards and that error conversion too, so it always
observes the final `Response`. Reach for `@intercept` for handler-scoped
concerns, and `wrap` for whole-request ambient context.
:::

## Next steps

- [The request lifecycle](/concepts/the-request-lifecycle/) — where each hook and
  `wrap` sits in the full per-request order.
- [Interceptors](/concepts/interceptors/) — the handler-scoped wrapper, and how
  it differs from `wrap`.
- [OpenTelemetry](/guides/opentelemetry/) — a real plugin built on `wrap` and the
  lifecycle hooks.
