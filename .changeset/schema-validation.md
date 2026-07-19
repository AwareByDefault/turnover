---
"turnover": minor
---

Add Standard Schema validation for route inputs and responses.

- Declare schemas on a route decorator's options — `@post("/", { body, query, params, response })` — using any [Standard Schema](https://standardschema.dev)-compatible validator (Zod, Valibot, ArkType, TypeBox with its adapter, …). turnover takes **no dependency** on a validator; it only speaks the interface.
- Validated (and coerced) inputs are exposed on `ctx.valid.body` / `ctx.valid.query` / `ctx.valid.params`. `ctx.body()` still returns the raw body. Cast `ctx.valid.*` to the schema's output type (or use `InferOutput<typeof Schema>`) — standard decorators can't flow the type onto the handler signature.
- A failed input validation throws a `422` with `{ error: { code: "validation_failed", details: { location, issues } } }`. A failed `response` validation is a server bug — logged and returned as an opaque `500`.
- Validation runs after guards. Exposes `StandardSchemaV1`, `RouteSchemas`, `InferInput`/`InferOutput`, `validate`, `issuePath`, and the Standard Schema result/issue types.
