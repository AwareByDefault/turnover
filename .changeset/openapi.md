---
"turnover": minor
---

Add OpenAPI 3.1 document generation.

- **`app.openapi(options)`** builds an OpenAPI 3.1 document from the mounted routes: paths (with `:param` → `{param}`), methods, path/query parameters, request bodies, and responses.
- Declare per-route metadata (`summary`, `description`, `tags`, `operationId`, `deprecated`) via a new `openapi` field on the route decorator options (`@get("/:id", { params, response, openapi: { summary } })`). `RouteOptions` is exposed for the combined schema + openapi shape.
- Because Standard Schema doesn't mandate a JSON-Schema export, pass `options.toJsonSchema` to include schema bodies (TypeBox schemas already are JSON Schema; Zod via `zod-to-json-schema`). Without it, the document still lists every path, method, and parameter (path params default to `string`).
- `options` also takes `info` and `servers`. Serve the document however you like (e.g. via an `onRequest` hook). Exposes `OpenApiOptions`, `OpenApiDocument`, `OpenApiInfo`, `OpenApiServer`, and `OperationMeta`.
