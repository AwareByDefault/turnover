---
title: OpenTelemetry
description: Add distributed tracing in one line with the turnover/otel plugin, and trace service methods with @traced.
sidebar:
  order: 4
---

Turnover ships OpenTelemetry tracing behind the `turnover/otel` subpath. Enabling it is one
line, and the core package stays dependency-free — only apps that opt in pull in
`@opentelemetry/api`.

## Enable tracing

Register the `otel()` plugin and every request gets a server span:

```ts title="server.ts"
import { createApp } from "turnover";
import { otel } from "turnover/otel";

const app = await createApp({ plugins: [otel()] });
```

With no options, `otel()`:

- Opens a `SERVER` span per request named by the **matched route** —
  `GET /users/:id`, not the raw URL — so span names stay low-cardinality.
- Sets HTTP semantic-convention attributes (`http.request.method`, `url.path`,
  `url.scheme`, `server.address`, `http.route`, `user_agent.original`, …) and records the
  response `http.response.status_code`.
- Continues an incoming [W3C `traceparent`](https://www.w3.org/TR/trace-context/), so the
  span joins an upstream trace when one is present.
- Records exceptions and any 5xx response as span errors.
- Makes the span the **active context** for the request, so `@traced` service methods —
  and any OTel-instrumented client you call from a handler — nest under it automatically.

The plugin is registered as a [`wrap`](/concepts/lifecycle-hooks-and-plugins/): it is
outermost, wrapping guards, the handler, and error handling, which is why it can time the
whole request and see the final response.

## Tune the server span

`otel()` takes an options object when the defaults aren't enough:

```ts title="server.ts"
otel({
  ignore: (ctx) => ctx.route === "/health",              // skip noisy routes
  enrich: (span, ctx) => span.setAttribute("tenant", ctx.store.tenant),
  captureRequestHeaders: ["x-request-id"],               // recorded as http.request.header.<name>
});
```

- `ignore(ctx)` — return `true` to skip tracing a request entirely.
- `enrich(span, ctx)` — add extra attributes after the defaults are set.
- `captureRequestHeaders` — request header names to record as
  `http.request.header.<name>` attributes.
- `tracerName` / `tracerVersion` — override the tracer identity (default name
  `"turnover"`).

## Trace service methods with `@traced`

`@traced` adds child spans that nest under the active server span. On a **method** it
traces just that method; on a **class** it traces every public method, with a per-method
`@noTrace` opt-out:

```ts title="orders.service.ts"
import { injectable } from "turnover";
import { traced, noTrace } from "turnover/otel";

@traced()                       // trace every public method of this service…
@injectable()
export class Orders {
  async place(order: Order) {
    /* span "Orders.place" */
  }

  @noTrace                      // …except this one
  private priceOf(order: Order) {
    /* not traced */
  }
}
```

Or trace a single method and shape its span with `kind`, static `attributes`, and an
`enrich` callback that can read the call's arguments:

```ts title="payments.service.ts"
import { SpanKind } from "@opentelemetry/api";
import { traced } from "turnover/otel";

export class Payments {
  @traced({
    kind: SpanKind.CLIENT,
    attributes: { "peer.service": "stripe" },
    enrich: (span, jp) => span.setAttribute("charge.id", String(jp.args[0])),
  })
  async charge(id: string) {
    /* span "Payments.charge" */
  }
}
```

A method-level `@traced({ name })` overrides the span name; a class-level `@traced` always
names each span `"<Class>.<method>"` and ignores `name`. The default span `kind` is
`INTERNAL`.

:::note
`@traced` is built on Turnover's [method-advice](/concepts/method-advice/) seam, so the
class must be constructed through the container (created via `createApp`, which
auto-registers the aspect processor). A `@traced` class you instantiate with `new`
yourself is not woven.
:::

## Bring your own SDK

`turnover/otel` depends only on the stable OpenTelemetry **API**; your app registers the
**SDK** (exporter, resource, context manager). `@opentelemetry/api` is an **optional peer
dependency**, and this integration follows the standard OTel contract:

:::tip
With no SDK registered, every tracing call is a **no-op with zero overhead** — you can
leave `otel()` and `@traced` in place in tests and local runs without wiring an exporter.
:::

Install the API and an SDK alongside Turnover, then register the SDK before `createApp`:

```bash
bun add @opentelemetry/api @opentelemetry/sdk-node
```

## Next steps

- [Lifecycle hooks and plugins](/concepts/lifecycle-hooks-and-plugins/) — how `otel()` plugs in as a `wrap` around every request.
- [Method advice](/concepts/method-advice/) — the AOP seam that `@traced` builds on.
- [Deployment](/guides/deployment/) — run the traced app on your target runtime.
