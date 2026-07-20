---
title: Typed client
description: Generate a fully typed, dependency-free HTTP client from your app's OpenAPI document — with end-to-end type safety.
sidebar:
  order: 3
---

Turnover can't infer client types through decorators, so its typed client is **codegen-based**:
you dump the app's OpenAPI document, turn it into TypeScript types, and get a client whose
paths, params, bodies, and responses are all checked at compile time.

There are two flavours, depending on where you want the types to come from:

- **`createClient<paths>(config)`** — a runtime client driven by an
  [`openapi-typescript`](https://github.com/openapi-ts/openapi-typescript)-generated `paths`
  type. Zero runtime dependencies; you own the `paths` type.
- **`generateClient(doc)`** (from `turnover/codegen`) — emits a self-contained client
  **module** as TypeScript source, one method per operation. No `openapi-typescript` needed.

## `createClient` — typed by an `openapi-typescript` `paths` type

`createClient<paths>(config)` is a minimal, dependency-free HTTP client. It carries no types
of its own — it is parameterized by the `paths` type that `openapi-typescript` generates
from your spec.

The flow is three steps:

```bash
# 1. Dump the OpenAPI document from your app (offline — no server needed).
bun run dump-openapi.ts > openapi.json

# 2. Generate the paths type.
bunx openapi-typescript openapi.json -o api.d.ts
```

```ts title="dump-openapi.ts"
import { createApp } from "turnover";

const app = await createApp();
const doc = app.openapi({
  info: { title: "My API", version: "1.0.0" },
  // Convert your Standard Schemas to JSON Schema so bodies appear in the spec.
  toJsonSchema: (schema) => convertToJsonSchema(schema),
});
await Bun.write("openapi.json", JSON.stringify(doc));
```

Then import the generated `paths` type and create the client:

```ts title="api-client.ts"
import type { paths } from "./api";
import { createClient } from "turnover";

const api = createClient<paths>({ baseUrl: "https://api.example.com" });

const { data, error } = await api.get("/users/{id}", {
  params: { path: { id: "1" } },
});
//      ^ data is typed as the route's response; error holds a non-2xx payload

await api.post("/users", { body: { name: "Ada" } });
//                                ^ body is typed and checked against the route
```

### The `ClientConfig`

```ts
interface ClientConfig {
  baseUrl: string;
  headers?: Record<string, string>;          // sent on every request
  fetch?: (request: Request) => Promise<Response>; // override the fetch impl
}
```

### The `{ data, error }` result

Every call resolves to a `ClientResult`:

```ts
interface ClientResult<T> {
  data?: T;         // set only on a 2xx response (typed to the route's 200/201 body)
  error?: unknown;  // set only on a non-2xx response (the parsed body)
  response: Response; // the raw Response, always available (its body already read)
}
```

`data` and `error` are mutually exclusive: on a 2xx the client fills `data`, otherwise it
fills `error`. Either way the call **resolves** — the client never throws on an HTTP status,
so you branch on `error` rather than wrap the call in `try`/`catch`; only a transport (`fetch`)
failure rejects. JSON responses are parsed as JSON, everything else as text. Path params come
from `params.path`, query params from `params.query`, and per-call `headers` merge over the
config defaults.

Options are **required only when a route has path params or a body** — a parameter-free
`GET` can be called with just the path.

:::tip
Set `fetch` to `app.handle` to drive an app entirely in-memory — no socket, no base URL
that resolves to anything real. This makes `createClient` an excellent typed test client:

```ts
const api = createClient<paths>({
  baseUrl: "http://local",
  fetch: (req) => app.handle(req),
});
```

Wrap the call in an arrow (`(req) => app.handle(req)`) rather than passing `app.handle`
bare — `handle` is a method, so a bare reference would lose its `this`. See
[Testing](/guides/testing/) for the full in-memory testing story.
:::

## `generateClient` — emit a standalone client module

When you'd rather ship a concrete client than depend on `openapi-typescript` at build time,
`turnover/codegen` exposes `generateClient(doc, options?)`. It takes an OpenAPI document and
returns **TypeScript source** for a self-contained, dependency-free client — one method per
operation, named by its `operationId`, typed from that operation's params, body, and 2xx
response schema.

```ts title="gen-client.ts"
import { createApp } from "turnover";
import { generateClient } from "turnover/codegen";

const app = await createApp();
const source = generateClient(
  app.openapi({ info: { title: "API", version: "1" } }),
);
await Bun.write("client.ts", source);
```

```ts
interface GenerateClientOptions {
  clientName?: string; // name of the generated factory function (default "createClient")
}
```

The generated module exports a factory (default `createClient`) whose options are
`{ baseUrl?, headers?, fetch? }`. Its `fetch` is a global-`fetch`-shaped
`(url, init) => Promise<Response>`, so you can point it at an app in-memory with
`fetch: (url, init) => app.handle(new Request(url, init))`. Run this at build time and
commit or bundle the result.

## Next steps

- [OpenAPI](/guides/openapi/) — produce the document both clients are generated from, including `toJsonSchema`.
- [Testing](/guides/testing/) — pair either client with `app.handle` for typed, socket-free tests.
