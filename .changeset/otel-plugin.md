---
"turnover": minor
---

Add OpenTelemetry tracing via the `turnover/otel` subpath — convention-first, one line to enable.

- **`otel()` plugin** — `createApp({ plugins: [otel()] })` enables app-wide HTTP server tracing with zero config: a `SERVER` span per request named by the matched route (`GET /users/:id`, low-cardinality), W3C `traceparent` continuation, HTTP semantic-convention attributes, and exception/5xx recording. The server span is the **active** context, so nested spans attach to it automatically. Customize with `ignore` / `enrich` / `captureRequestHeaders`.
- **`@traced()`** — trace child spans (built on the AOP seam). On a **method** it traces that method; on a **class** it traces every public method, with a per-method **`@noTrace`** opt-out. Configure the spans with `@traced({ name, kind, attributes, enrich })` — `enrich(span, joinPoint)` can add attributes from the call's arguments.
- **`addAround(meta, method, advice)`** — the programmatic form of `@around` (apply advice to many methods at once); what class-level `@traced()` is built on.
- The core stays **dependency-free**: `turnover/otel` is a separate entry, and `@opentelemetry/api` is an *optional* peer dependency. With no OpenTelemetry SDK registered, every call is a no-op (zero overhead).

New framework primitives it's built on (also useful on their own):

- **`ctx.route`** — the matched route pattern (low-cardinality) on the handler `Context`, for telemetry span names, metric labels, and structured logging.
- **`createApp({ wrap })` / `app.wrap()` / `Plugin.wrap`** — wrap every request outermost (around guards, the handler, and error handling), seeing the final `Response`. The place to establish per-request ambient context.
