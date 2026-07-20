---
title: Validation
description: Validate a route's body, query, params, and response with any Standard Schema validator — Zod, Valibot, ArkType, or TypeBox — with no validator dependency in the framework.
sidebar:
  order: 6
---

Declare a schema on a route and Turnover validates the incoming request against it before
your handler runs. Validated (and coerced) values land on `ctx.valid`.

## Declare a schema on a route

Pass `body`, `query`, `params`, and/or `response` in the route decorator's options.

```ts title="users.controller.ts"
import { z } from "zod";
import { controller, post, type Context } from "turnover";

const CreateUser = z.object({ name: z.string(), age: z.coerce.number() });

@controller("/users")
export class UsersController {
  @post("/", { body: CreateUser })
  create(ctx: Context) {
    const input = ctx.valid.body as z.infer<typeof CreateUser>; // validated + coerced
    return { created: input }; // => 200 { "created": { "name": "Ada", "age": 42 } }
  }
}
```

Post `{ "name": "Ada", "age": "42" }` and the handler receives `age` already coerced to the
number `42`. Post `{ "name": "Ada" }` and the request is rejected with a `422` before
`create()` ever runs.

## Any Standard Schema validator

Turnover validates through the [Standard Schema](https://standardschema.dev) v1 interface
and takes **no dependency** on any validator. Zod, Valibot, ArkType, and TypeBox (with its
adapter) all implement Standard Schema, so any of them works — you install the one you like,
Turnover just speaks the shared interface.

## Reading validated values

Validated inputs are populated on `ctx.valid` — one field per schema you declared:

- `ctx.valid.body`
- `ctx.valid.query`
- `ctx.valid.params`

Each holds the schema's **output** type (post-coercion). Standard TC39 decorators can't flow
a schema's type onto the handler signature, so you **cast** the result:

```ts
const input = ctx.valid.body as z.infer<typeof CreateUser>;
// or, validator-agnostic:
import type { InferOutput } from "turnover";
const input = ctx.valid.body as InferOutput<typeof CreateUser>;
```

:::note
`ctx.valid.*` gives you the validated, coerced value. `ctx.body()` still returns the **raw**
parsed body, unchanged. Reach for `ctx.valid.body` once a schema is declared.
:::

Query strings are flattened to an object before validation (repeated keys become arrays), so
a `query` schema validates a plain object, not a `URLSearchParams`.

## Validation runs after guards

Inputs are validated **after** guards run, in the order `params` → `query` → `body`. That
ordering matters: an unauthenticated or unauthorized request is rejected by a guard before
any of its input is inspected.

The full per-request order is
[derivers → guards → validation → resolvers → handler](/concepts/deriving-context/).

## Failure shape

A failed **input** validation throws a `422 Unprocessable Entity` whose body pinpoints the
failure — the one framework-emitted error code, `validation_failed`:

```json
{
  "error": {
    "message": "Validation failed",
    "code": "validation_failed",
    "details": {
      "location": "body",
      "issues": [{ "message": "Expected number, received string", "path": ["age"] }]
    }
  }
}
```

`location` is whichever of `body` / `query` / `params` failed; `issues` lists each problem
with its message and path. Inputs are checked in the `params` → `query` → `body` order and
validation stops at the **first** one that fails, so a single response reports a single
`location` — fix it and re-send to surface the next.

## Response validation

Declare a `response` schema and Turnover validates your handler's return value too — but a
mismatch there is a **server** bug, not a client one. It's logged and returned as an opaque
`500`; the validation details are never sent to the client.

```ts title="users.controller.ts"
import { z } from "zod";

const UserOut = z.object({ id: z.string(), name: z.string() });

@controller("/users")
export class UsersController {
  @get("/:id", { response: UserOut })
  getOne(ctx: Context<{ id: string }>) {
    return this.repo.find(ctx.params.id); // shape mismatch => logged + opaque 500
  }
}
```

:::caution
Response validation guards *you* against shipping the wrong shape — treat a `500` from it as
"my handler returned something the schema didn't allow," and fix the handler or the schema.
:::

## Next steps

- [Controllers & routing](/concepts/controllers-and-routing/) — where route decorators and
  their options live.
- [Error handling](/concepts/error-handling/) — the `422` envelope, `HttpError`, and custom
  error handlers.
- [OpenAPI](/guides/openapi/) — the same schemas can describe your API in an OpenAPI
  document.
