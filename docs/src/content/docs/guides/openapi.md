---
title: OpenAPI
description: Generate an OpenAPI 3.1 document from your mounted routes and serve interactive docs with app.docs().
sidebar:
  order: 2
---

Turnover builds an [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) document straight
from the routes you have already mounted — no separate spec file to keep in sync.

## Build a document

`app.openapi(options?)` walks every mounted route and returns a plain
`OpenApiDocument` object:

```ts title="server.ts"
import { createApp } from "turnover";

const app = await createApp({ controllers: [UsersController] });

const spec = app.openapi({
  info: { title: "My API", version: "1.0.0" },
});
// => { openapi: "3.1.0", info: { ... }, paths: { "/users/{id}": { get: { ... } } } }
```

For each route it captures:

- The **path**, converting `:param` segments to OpenAPI's `{param}` form
  (`/users/:id` becomes `/users/{id}`).
- The **method** (`get`, `post`, …) as an operation on that path.
- **Path parameters** (always `required`) and **query parameters** (required when the
  query schema marks them so).
- The **request body** (as `application/json`) and a **200** response.

Without any extra configuration, path parameters default to `{ "type": "string" }` and the
info block defaults to `title: "turnover API"`, `version: "0.0.0"`.

## Describe routes

Add per-route metadata through the route decorator's `openapi` option, and attach
validation schemas (`params`, `query`, `body`, `response`) the same way you would for
[validation](/concepts/validation/) — the generator reads both:

```ts title="users.controller.ts"
import { controller, get, type Context } from "turnover";
import { IdParams, User } from "./schemas";

@controller("/users")
export class UsersController {
  @get("/:id", {
    params: IdParams,
    response: User,
    openapi: { summary: "Fetch a user", tags: ["users"] },
  })
  getOne(ctx: Context<{ id: string }>) {
    // ...
  }
}
```

The `openapi` object accepts `summary`, `description`, `tags`, `operationId`, and
`deprecated`. When you omit `operationId`, Turnover derives a readable one from the method
and path (`GET /users/{id}` becomes `getUsersId`).

## Include schema bodies

Standard Schema — the interface Turnover validates against — does not mandate a
JSON-Schema export, so schema bodies are **omitted from the document unless you provide a
converter**. Pass `toJsonSchema` to turn each attached schema into JSON Schema:

```ts title="server.ts"
import { zodToJsonSchema } from "zod-to-json-schema";

const spec = app.openapi({
  info: { title: "My API", version: "1.0.0" },
  toJsonSchema: (schema) => zodToJsonSchema(schema as never),
});
```

TypeBox schemas already *are* JSON Schema, so the converter is the identity function:

```ts
app.openapi({ toJsonSchema: (schema) => schema });
```

:::note
Without `toJsonSchema` the document is still complete in structure — every path, method,
and parameter is listed — it just omits the request/response body schemas.
:::

## Serve the spec

The document is a value; serve it however you like. One way is an
[`onRequest` hook](/concepts/lifecycle-hooks-and-plugins/) that answers a fixed path:

```ts title="server.ts"
const spec = app.openapi({ toJsonSchema: (s) => zodToJsonSchema(s as never) });

app.onRequest((req) =>
  new URL(req.url).pathname === "/openapi.json"
    ? Response.json(spec)
    : undefined,
);
```

## Serve docs with `app.docs()`

`app.docs()` does the wiring for you. It mounts `GET /openapi.json` (the spec) and, unless
you disable it, `GET /docs` — an interactive [Scalar](https://scalar.com) API reference.
Chain it after `createApp`:

```ts title="server.ts"
const app = (await createApp()).docs();
app.listen(); // GET /openapi.json and GET /docs are now live
```

Configure it through `DocsOptions`:

```ts
app.docs({
  jsonPath: "/openapi.json",                 // spec path (default)
  uiPath: "/docs",                           // UI path; pass false to disable the UI
  openapi: { info: { title: "My API", version: "1.0.0" } }, // OpenApiOptions
});
```

The `openapi` field takes the same options as `app.openapi()`, so add your
`info`, `servers`, and `toJsonSchema` there to get schema-rich docs.

:::caution
The docs UI loads the Scalar bundle from a public CDN (`cdn.jsdelivr.net`) via a
`<script>` tag. If you serve `/docs` in an environment without outbound network access,
disable the UI with `uiPath: false` and keep just `/openapi.json`.
:::

## Next steps

- [Validation](/concepts/validation/) — attach the schemas that flesh out your spec.
- [Typed client](/guides/typed-client/) — turn the generated spec into an end-to-end typed client.
- [Lifecycle hooks and plugins](/concepts/lifecycle-hooks-and-plugins/) — the `onRequest` hook used to serve the spec.
