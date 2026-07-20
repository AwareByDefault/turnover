---
title: Controllers & routing
description: Mount classes as controllers, map methods to HTTP verbs, and turn return values into responses.
sidebar:
  order: 1
---

A **controller** is a class decorated with `@controller("/base")`. Its methods become routes
when you decorate them with an HTTP-verb decorator. Each handler receives a `Context` and
returns a value that Turnover coerces into a `Response`.

```ts title="users.controller.ts"
import { type Context, controller, del, get, inject, post } from "turnover";
import { UserService } from "./user.service";

@controller("/users")
export class UsersController {
  private readonly users = inject(UserService);

  @get("/")
  list() {
    return { users: this.users.all() }; // object → JSON
  }

  @get("/:id")
  getOne(ctx: Context<{ id: string }>) {
    const user = this.users.find(ctx.params.id);
    if (!user) return new Response("Not found", { status: 404 });
    return { user };
  }

  @post("/")
  async create(ctx: Context) {
    const input = await ctx.body<{ name: string }>();
    return Response.json({ created: this.users.add(input) }, { status: 201 });
  }

  @del("/:id")
  remove(ctx: Context<{ id: string }>) {
    return { deleted: this.users.remove(ctx.params.id) };
  }
}
```

Turnover reads a controller's routes and guards from the class metadata **at mount time** —
after every decorator has run — so the relative order of `@controller` and the other class
decorators never matters.

## The verb decorators

| Decorator | HTTP method |
| --------- | ----------- |
| `@get(path?, options?)`    | `GET`    |
| `@post(path?, options?)`   | `POST`   |
| `@put(path?, options?)`    | `PUT`    |
| `@patch(path?, options?)`  | `PATCH`  |
| `@del(path?, options?)`    | `DELETE` |

`@del` is named `del` because `delete` is a reserved word in JavaScript — the decorator maps
to the `DELETE` method.

The `path` defaults to `""` (the controller's base). The optional second argument declares
per-route validation schemas (`body` / `query` / `params` / `response`) and `openapi`
metadata — see [Validation](/concepts/validation/) and [OpenAPI](/guides/openapi/).

## Path joining & normalization

A route's final pattern is the module prefix (if any) joined with the controller base and the
method path. Joining then **normalizes**: duplicate slashes collapse, and the trailing slash
is dropped (except for root `/`).

```ts
@controller("/users")     // base
class UsersController {
  @get("/:id")            // method path  →  pattern "/users/:id"
  getOne() { /* ... */ }

  @get("/")               // →  "/users"  (trailing slash dropped)
  list() { /* ... */ }
}
```

So `@controller("/users/")` + `@get("//active")` still resolves to `/users/active`. A
`:name` segment captures a path param into `ctx.params.name`.

## The `Context` object

Every handler is called with a single `Context` argument. Type its path params with the
generic: `Context<{ id: string }>`.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `ctx.req` | `Request` | The raw Web `Request`. |
| `ctx.route` | `string` | The matched pattern, e.g. `/users/:id` — low-cardinality (unlike `req.url`), ideal for telemetry span names, metric labels, and structured logging. `""` for a 404. |
| `ctx.params` | `Record<string, string>` | Path params captured from the pattern. |
| `ctx.query` | `URLSearchParams` | The parsed query string. |
| `ctx.body<T>()` | `() => Promise<T>` | Lazily reads and parses the **raw** body (JSON when the content-type says so). The result is cached, so validation and your handler read the body once. |
| `ctx.valid` | `ValidatedInputs` | Validated, coerced inputs — populated only for the inputs a route declared a schema for. See [Validation](/concepts/validation/). |
| `ctx.set` | `ResponseState` | Mutate the outgoing status and headers of a coerced return value. See [Responses & cookies](/concepts/responses-and-cookies/). |
| `ctx.cookies` | `Cookies` | Read incoming cookies and queue `Set-Cookie`s. See [Responses & cookies](/concepts/responses-and-cookies/). |
| `ctx.store` | `RequestStore` | Per-request values populated by `@derive`/`@resolve`. See [Deriving context](/concepts/deriving-context/). |

:::note
`ctx.body()` always returns the **raw** parsed body. Validated, coerced input lives on
`ctx.valid.body` (only when the route declared a `body` schema).
:::

## Return-value coercion

You rarely build a `Response` by hand. Return a plain value and Turnover coerces it:

| You return | Becomes |
| ---------- | ------- |
| a `Response` | passed through unchanged |
| a `string` | `200` with `content-type: text/plain;charset=utf-8` |
| `null` / `undefined` | `204 No Content` |
| any other value | `Response.json(value)` |

```ts
@get("/plain")
plain() {
  return "hello";                 // → 200 text/plain
}

@get("/json")
json() {
  return { ok: true };            // → 200 application/json
}

@del("/:id")
remove(ctx: Context<{ id: string }>) {
  ctx.set.status = 202;           // set the status for a coerced value
  return null;                    // → 202 (an explicit status wins over the 204 default)
}
```

The status comes from `ctx.set.status`; a value of `null`/`undefined` with no status set
becomes `204`. Returning a `Response` yourself bypasses coercion entirely — its own status
and headers stand (though queued cookies and `ctx.set.headers` are still merged on).

## When no route matches

- **No pattern matches the path → `404`** with a JSON body
  `{ "error": { "message": "No route for GET /path" } }`.
- **The path matches but the method doesn't → `405`** with
  `{ "error": { "message": "Method Not Allowed" } }` and an `Allow` header listing the
  methods that *are* registered for that pattern.

```bash
curl -i -X PUT localhost:3000/users        # only GET/POST registered
# HTTP/1.1 405 Method Not Allowed
# Allow: GET, POST
```

## Registering controllers

With zero-config auto-discovery (`await createApp()`), any file containing `@controller`
under the entry directory is imported and mounted. To stay explicit — for tests or bundled,
filesystem-free deploys — pass the classes directly:

```ts title="server.ts"
import { createApp } from "turnover";
import { UsersController } from "./users.controller";

const app = await createApp({ controllers: [UsersController] });
app.listen(3000);
```

See [Modules](/concepts/modules/) for grouping controllers under a shared prefix and
cross-cutting behavior.

## Next steps

- [Dependency injection](/concepts/dependency-injection/) — how `inject()` wires services into controllers.
- [Validation](/concepts/validation/) — declare `body`/`query`/`params` schemas and read `ctx.valid`.
- [Responses & cookies](/concepts/responses-and-cookies/) — shape responses via `ctx.set` and `ctx.cookies`.
- [The request lifecycle](/concepts/the-request-lifecycle/) — the full path a request takes to your handler.
