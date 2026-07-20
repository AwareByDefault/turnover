---
title: Parsing & serialization
description: Change how request bodies are parsed and how return values become responses by registering custom BodyParsers and ResponseSerializers.
sidebar:
  order: 10
---

By default Turnover parses request bodies as JSON (or raw text) and coerces return values
into responses. Register **parsers** and **serializers** to handle other formats.

## The defaults

Out of the box:

- **Body parsing** (`ctx.body()`): a body sent with a JSON content type is `JSON.parse`d;
  anything else comes back as raw text. An empty body reads as `undefined`.
- **Response coercion**: a returned `Response` passes through untouched; a `string` becomes
  `text/plain`; `null` / `undefined` becomes a `204`; any other value becomes JSON.

You only need parsers and serializers when you want to step outside those defaults.

## Register a `BodyParser`

A `BodyParser` claims one or more content types and parses the request. Once registered,
`ctx.body()` uses it whenever the request's content type matches.

```ts title="server.ts"
import { createApp, type BodyParser } from "turnover";

const csv: BodyParser = {
  contentTypes: ["text/csv"], // exact, a subtype wildcard, or catch-all
  parse: async (req) => (await req.text()).split(","),
};

const app = await createApp({ controllers: [ReportsController], parsers: [csv] });
```

Now a handler that calls `ctx.body()` on a `text/csv` request receives the parsed array:

```ts title="reports.controller.ts"
@post("/import")
async import(ctx: Context) {
  const rows = await ctx.body<string[]>(); // parsed by the csv BodyParser
  return { count: rows.length };
}
```

`contentTypes` entries are matched against the request's media type (parameters like
`; charset=utf-8` are ignored) three ways:

- **Exact** — `"text/csv"`.
- **Subtype wildcard** — `"text/*"` matches any `text/…` type.
- **Catch-all** — `"*/*"` matches everything.

Parsers are tried in registration order; the first match wins, and if none matches the
built-in JSON/text default applies.

## Register a `ResponseSerializer`

A `ResponseSerializer` gets first crack at a handler's **non-`Response`** return value. Its
`serialize(value, ctx)` returns a `Response` to handle the value, or `undefined` to defer to
the next serializer (and finally the JSON/text default).

```ts title="server.ts"
import { createApp, type ResponseSerializer } from "turnover";

const envelope: ResponseSerializer = {
  serialize: (value) =>
    value && typeof value === "object" ? Response.json({ data: value }) : undefined,
};

const app = await createApp({ controllers: [...], serializers: [envelope] });
// a handler returning { id: 1 }  =>  { "data": { "id": 1 } }
```

Because `serialize` receives the `ctx`, a serializer can:

- **Content-negotiate** — inspect `ctx.req.headers.get("accept")` and emit JSON, XML, etc.
- **Wrap** — envelope every response in a consistent shape (as above).
- **Stream** — return a `Response` built from a `ReadableStream`.

:::note
Serializers only see values your handler *returns as data*. A handler that builds and returns
a `Response` itself bypasses serializers entirely — that response passes straight through.
:::

## Registering both at once

Pass `parsers` and `serializers` to `createApp`, or register them after construction with
`app.addParser(...)` / `app.addSerializer(...)`:

```ts
const app = await createApp({
  controllers: [...],
  parsers: [csv],
  serializers: [envelope],
});
```

Plugins can contribute both, too — a plugin's `parsers` and `serializers` are merged in when
it's registered. The built-in `multipart()` plugin, for instance, works by registering a
`BodyParser` for `multipart/form-data`.

## Next steps

- [Controllers & routing](/concepts/controllers-and-routing/) — `ctx.body()` and how return
  values become responses.
- [Lifecycle hooks & plugins](/concepts/lifecycle-hooks-and-plugins/) — how a plugin bundles
  parsers, serializers, and hooks together.
