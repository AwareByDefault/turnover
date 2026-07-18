# turnover

**Decorator-first REST framework for Bun** — inject your dependencies, mount
controllers, and let them rest.

A small, Bun-native REST framework built on **standard TC39 decorators** — no
`experimentalDecorators`, no `emitDecoratorMetadata`, no Reflect-metadata. It
gives you `@controller` / `@get` routing, a tiny dependency-injection container,
and request-scoped auth on top of `Bun.serve`.

## Install

```bash
bun add turnover
```

Define a controller and boot it:

```ts
// server.ts
import { controller, createApp, get } from "turnover";

@controller("/hello")
class HelloController {
  @get("/")
  hello() {
    return { message: "Hello from turnover" };
  }
}

const app = await createApp({ controllers: [HelloController] });
const server = app.listen(3000);

console.log(`🚀 Server running at ${server.url}`);
```

> Requires [Bun](https://bun.sh) — the framework calls `Bun.serve`, `Bun.Glob`,
> `Bun.main`, and `Bun.file` directly. Works under the default `tsconfig.json`;
> no decorator-related compiler flags are needed.

## Running this repo

This repo also ships a runnable demo app in [src/app/](src/app/). Install
dependencies and start the dev server (hot reload via `--watch`):

```bash
bun install
bun run dev
```

The server listens on [http://localhost:3000](http://localhost:3000). On boot it
auto-discovers controllers and prints the route table:

```
🚀 Server running at http://localhost:3000/
📍 Routes: { "/users": ["GET","POST"], "/users/:id": ["GET","DELETE"], "/me": ["GET"], ... }
```

## Concepts

The framework lives in [src/framework/](src/framework/) and is re-exported from a
single entry point, [src/framework/index.ts](src/framework/index.ts). Your app
code lives in [src/app/](src/app/). The entry file just boots the app:

```ts
// src/index.ts
import { createApp } from "./framework";

const app = await createApp(); // scans the source tree for @controller classes
const server = app.listen(3000);

console.log(`🚀 Server running at ${server.url}`);
console.log("📍 Routes:", app.routeTable());
```

### Controllers & routes

Decorate a class with `@controller("/base")` and its methods with an HTTP-verb
decorator. Each handler receives a `Context` and returns a value that is coerced
into a `Response`.

```ts
import { type Context, controller, del, get, inject, post } from "../framework";
import { GreetingService } from "./greeting.service";

@controller("/users")
export class UsersController {
  private readonly greeter = inject(GreetingService);
  private readonly users = new Map<string, User>();

  @get("/")
  list() {
    return { users: [...this.users.values()] }; // object → JSON
  }

  @get("/:id")
  getOne(ctx: Context<{ id: string }>) {
    const user = this.users.get(ctx.params.id);
    if (!user) return new Response(`No user "${ctx.params.id}"`, { status: 404 });
    return { user };
  }

  @post("/")
  async create(ctx: Context) {
    const user = await ctx.body<User>();
    this.users.set(user.id, user);
    return Response.json({ created: user }, { status: 201 });
  }

  @del("/:id")
  remove(ctx: Context<{ id: string }>) {
    return { deleted: this.users.delete(ctx.params.id) };
  }
}
```

Route decorators: `@get`, `@post`, `@put`, `@patch`, `@del` (named `del` because
`delete` is reserved). Paths are joined with the controller base and normalized
(duplicate and trailing slashes collapsed).

**The `Context` object:**

| Field          | Type                         | Description                                        |
| -------------- | ---------------------------- | -------------------------------------------------- |
| `ctx.req`      | `Request`                    | The raw Web `Request`.                             |
| `ctx.params`   | `Record<string, string>`     | Path params from the pattern (e.g. `/:id`).        |
| `ctx.query`    | `URLSearchParams`            | Parsed query string.                               |
| `ctx.body<T>()`| `() => Promise<T>`           | Lazily reads + parses the body (JSON by content-type). |

**Return-value coercion** (in [app.ts](src/framework/app.ts)):

- `Response` → passed through unchanged
- `string` → `text/plain`
- `null` / `undefined` → `204 No Content`
- any other object → JSON

### Dependency injection

Mark a class `@injectable()` and pull it in with `inject(Token)` in a field
initializer — no constructor, no parameter decorators (standard decorators don't
have them). The container sets an ambient reference while constructing, which is
what lets `inject()` resolve.

```ts
import { injectable } from "../framework";

@injectable() // default scope: "singleton"
export class GreetingService {
  private count = 0;
  greet(name: string) {
    return `Hello, ${name}! (greeting #${(this.count += 1)})`;
  }
}
```

```ts
@controller("/users")
export class UsersController {
  private readonly greeter = inject(GreetingService); // resolved at construction
}
```

Scopes: `"singleton"` (default, cached and shared) or `"transient"` (new instance
per resolve) via `@injectable({ scope: "transient" })`. Controllers are
instantiated through the same container, so they can inject services. Circular
dependencies are detected and throw with a helpful message.

> `inject()` only works while the container is constructing an
> `@injectable` / `@controller`. Calling it at module top level throws.

### Guards & auth

`@use(...guards)` attaches middleware to a whole controller or a single route. A
guard returns nothing to continue, or returns/throws a `Response` to
short-circuit (e.g. a 401/403).

```ts
import { Auth, controller, get, inject, use } from "../framework";
import { authenticate, requireRole } from "./auth";

@controller("/me")
@use(authenticate) // runs before every route in this controller
export class MeController {
  private readonly auth = inject(Auth);

  @get("/")
  whoami() {
    return this.auth.user; // typed as your app's Principal
  }

  @get("/admin")
  @use(requireRole("admin")) // stacks on top of the controller guard
  adminOnly() {
    return { secret: `Hello admin ${this.auth.user.name}` };
  }
}
```

Request-scoped state lives in an `AsyncLocalStorage`, so `Auth` can be a plain
singleton whose getters read the *current* request's principal at call time —
injecting it into a singleton controller still yields per-request data.

- `Auth.user` — the principal, or throws `401` if unauthenticated
- `Auth.optional` — the principal or `null`
- `Auth.isAuthenticated` — boolean
- `requireAuth` — a ready-made guard that 401s when no principal is set

A guard authenticates by calling `setPrincipal(...)`. Type your user by
augmenting the framework's empty `Principal` interface (see
[src/app/auth.ts](src/app/auth.ts)):

```ts
declare module "../framework/auth" {
  interface Principal {
    id: string;
    name: string;
    roles: string[];
  }
}

export const authenticate: Guard = (ctx) => {
  const token = ctx.req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const user = token ? USERS[token] : undefined;
  if (!user) return new Response("Unauthorized", { status: 401 });
  setPrincipal(user); // now Auth.user resolves to this for the rest of the request
};
```

### Deriving request context

`@derive(...)` runs functions **before guards** to compute per-request values,
which land on `ctx.store` (and are readable from injected singletons via
`getRequestStore()`). Return an object to merge into the store, or write
`ctx.store` directly; throw to abort. Type the store by augmenting `RequestStore`.

```ts
import { controller, derive, get, use, type Context } from "../framework";

declare module "../framework/request" {
  interface RequestStore { tenant: string }
}

@controller("/orders")
@derive((ctx) => ({ tenant: ctx.req.headers.get("x-tenant") ?? "public" }))
@use(requireTenant) // guards run after derivers, so they can read ctx.store
export class OrdersController {
  @get("/")
  list(ctx: Context) {
    return { tenant: ctx.store.tenant };
  }
}
```

Order per request: **derivers → guards → validation → handler**. Class-level
derivers run before method-level ones.

### Response control & cookies

Return a value and let it be coerced, or shape the response through `ctx.set` and
`ctx.cookies` without constructing a `Response` by hand.

```ts
@controller("/session")
export class SessionController {
  @post("/login")
  login(ctx: Context) {
    ctx.set.status = 201;                       // status for the coerced body
    ctx.set.headers.set("cache-control", "no-store");
    ctx.cookies.set("session", token, {         // queued as Set-Cookie
      httpOnly: true, secure: true, sameSite: "lax", maxAge: 3600,
    });
    return { ok: true };
  }

  @get("/me")
  me(ctx: Context) {
    const sid = ctx.cookies.get("session");     // read an incoming cookie
    return { sid };
  }

  @post("/logout")
  logout(ctx: Context) {
    ctx.cookies.delete("session");              // expire it
    return null;                                 // 204, still carries Set-Cookie
  }
}
```

- `ctx.set.status` sets the status of a **coerced** return value (a returned
  `Response` keeps its own status).
- `ctx.set.headers` (a `Headers`) is merged onto the response — even a returned
  `Response`, keeping that response's own headers.
- `ctx.cookies` reads incoming cookies (`get` / `has` / `all`) and queues
  outgoing ones (`set` / `delete`); values are URL-encoded. `set.headers` and
  cookies apply to **every** response, including a guard's short-circuit.

### Validation

Declare [Standard Schema](https://standardschema.dev)-compatible schemas
(Zod, Valibot, ArkType, TypeBox with its adapter, …) on a route to validate its
`body`, `query`, `params`, and `response`. turnover takes **no dependency** on any
validator — it only speaks the Standard Schema interface.

```ts
import { z } from "zod";
import { controller, post, type Context } from "../framework";

const CreateUser = z.object({ name: z.string(), age: z.coerce.number() });

@controller("/users")
export class UsersController {
  @post("/", { body: CreateUser })
  create(ctx: Context) {
    const user = ctx.valid.body as z.infer<typeof CreateUser>;
    return { created: user }; // age has been coerced to a number
  }
}
```

Validated (and coerced) values land on `ctx.valid.body` / `ctx.valid.query` /
`ctx.valid.params`. Because standard decorators can't flow the schema's type onto
the handler signature, cast `ctx.valid.*` to the schema's output type (or use
`InferOutput<typeof Schema>`). `ctx.body()` still returns the *raw* body.

- A failed input validation throws a **`422`** whose body pinpoints the failure:
  `{ error: { code: "validation_failed", details: { location, issues } } }`.
- A failed **`response`** validation is treated as a server bug — logged, returned
  as an opaque `500`.
- Validation runs **after guards** (so auth rejects before input is inspected).

### Error handling

Throw an `HttpError` (or a named subclass) from a handler or guard and the
framework renders it as a JSON envelope with the right status. Anything that
isn't an `HttpError` becomes an opaque `500` (its message is never leaked to the
client) and is logged.

```ts
import { controller, get, NotFoundError, HttpError } from "../framework";

@controller("/users")
export class UsersController {
  @get("/:id")
  getOne(ctx: Context<{ id: string }>) {
    const user = this.users.get(ctx.params.id);
    if (!user) throw new NotFoundError(`No user "${ctx.params.id}"`);
    // → 404  { "error": { "message": "No user \"…\"" } }
    return { user };
  }
}

// custom status / code / details:
throw new HttpError(402, "Trial expired", { code: "trial_expired" });
```

Named subclasses: `BadRequestError` (400), `UnauthorizedError` (401),
`PaymentRequiredError` (402), `ForbiddenError` (403), `NotFoundError` (404),
`ConflictError` (409), `GoneError` (410), `UnprocessableEntityError` (422),
`TooManyRequestsError` (429), `InternalServerError` (500). Extend `HttpError` for
your own domain errors.

**Custom error handlers** map thrown values to responses. An `ErrorHandler`
returns a `Response` to handle the error, or nothing to defer to the next handler
in the chain — **route → controller → global → framework default**:

```ts
import { catchError, createApp, type ErrorHandler } from "../framework";

const onError: ErrorHandler = (err) => {
  if (err instanceof MyDomainError) return Response.json({ oops: err.message }, { status: 400 });
  // return nothing → fall through to the default renderer
};

// global:
const app = await createApp({ controllers: [...], onError });
app.onError(anotherHandler); // or register later

// controller- or route-scoped:
@controller("/orders")
@catchError(onError)
class OrdersController {
  @get("/:id") @catchError(routeSpecificHandler) getOne() { ... }
}
```

### Auto-discovery

`createApp()` scans the entry file's directory tree (`**/*.ts` via `Bun.Glob`),
imports any file whose source contains `@controller(`, and each `@controller`
self-registers as its module loads. No manual controller imports or registration.

To skip the filesystem scan (e.g. for bundling, or in tests), pass controllers
explicitly — **exactly those** are mounted, isolated from whatever else has been
imported:

```ts
import { UsersController } from "./app/users.controller";
import { MeController } from "./app/me.controller";

const app = await createApp({ controllers: [UsersController, MeController] });
```

`CreateAppOptions`: `dir` (scan root, defaults to the entry dir), `controllers`
(explicit list — mounts only these and skips the scan), `container` (reuse an
existing `Container`).

### In-memory requests & testing

`app.handle(request)` runs a single `Request` through the whole pipeline (routing,
guards, DI, response coercion) and returns a `Response` — **without opening a
socket**. `listen()` serves through the same method, so an in-memory call behaves
exactly like a live request. That makes it ideal for tests and offline tooling:

```ts
const app = await createApp({ controllers: [UsersController] });

const res = await app.handle(new Request("http://local/users/1"));
expect(res.status).toBe(200);
expect(await res.json()).toEqual({ user: { id: "1", name: "Ada" } });
```

`listen(port)` returns Bun's [`Server`](https://bun.sh/docs/api/http) — use
`.stop()`, `.port`, and `.url` on it directly, and pass `0` for an OS-assigned
port (handy for parallel test servers):

```ts
const server = app.listen(0);
const res = await fetch(`${server.url}users`);
server.stop();
```

## Trying it out

```bash
# create a user
curl -X POST localhost:3000/users -H 'content-type: application/json' \
  -d '{"id":"1","name":"Ada"}'

# list users
curl localhost:3000/users

# authenticated route (see src/app/auth.ts for the toy token table)
curl localhost:3000/me -H 'authorization: Bearer alice-token'

# admin-only route
curl localhost:3000/me/admin -H 'authorization: Bearer alice-token'
```

## Public API

Everything is exported from [src/framework/index.ts](src/framework/index.ts):

| Export | Kind | Purpose |
| ------ | ---- | ------- |
| `createApp`, `App`, `CreateAppOptions` | bootstrap | Discover controllers, wire DI, build routes, `listen()` or `handle(req)`. |
| `controller`, `get`, `post`, `put`, `patch`, `del` | decorators | Define a REST controller and its routes. |
| `use`, `Guard` | middleware | Attach guards to a controller or route. |
| `HttpError` (+ subclasses), `catchError`, `ErrorHandler`, `toErrorResponse` | errors | HTTP error types + handlers mapping thrown values to responses. |
| `StandardSchemaV1`, `RouteSchemas`, `InferOutput`, `validate` | validation | Validate `body`/`query`/`params`/`response` via Standard Schema. |
| `Cookies`, `CookieOptions`, `ResponseState` | response | Shape the response via `ctx.set` (status/headers) and `ctx.cookies`. |
| `injectable`, `inject`, `Container`, `Scope` | DI | Register and resolve services. |
| `Auth`, `Principal`, `requireAuth` | auth | Request-scoped principal accessor + guard. |
| `getRequestState`, `setPrincipal`, `RequestState` | request scope | Read/attach per-request state (backed by `AsyncLocalStorage`). |
| `derive`, `Deriver`, `RequestStore`, `getRequestStore` | request context | Compute per-request values (`ctx.store`) before guards. |
| `Context`, `Ctor`, `HttpMethod` | types | Handler context and shared type aliases. |

## Project layout

```
src/
  index.ts              # entry: createApp().listen(3000)
  framework/            # the framework
    index.ts            #   public API barrel
    app.ts              #   createApp, App, discovery, Response coercion
    http.ts             #   @controller, route decorators, @use, Context
    di.ts               #   Container, inject(), @injectable
    auth.ts             #   Auth accessor, Principal, requireAuth
    request.ts          #   AsyncLocalStorage request scope
    metadata.ts         #   Symbol.metadata polyfill + shared metadata keys
  app/                  # the demo app
    users.controller.ts
    me.controller.ts
    greeting.service.ts
    auth.ts             #   demo authenticate / requireRole guards
```

## Requirements

- [Bun](https://bun.sh) (uses `Bun.serve`, `Bun.Glob`, `Bun.main`, `Bun.file`).
- Standard TC39 decorators only — works under the default `tsconfig.json`; no
  decorator-related compiler flags are enabled.
```