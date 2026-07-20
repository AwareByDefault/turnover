---
title: Guards & auth
description: Attach guards with @use to authenticate and authorize requests, and read the current principal from anywhere with the request-scoped Auth accessor.
sidebar:
  order: 5
---

A **guard** is a function that runs before a route handler. It can let the request through,
or short-circuit it with a `Response` (typically a `401` or `403`). Guards are how Turnover
does authentication and authorization.

## Attach a guard with `@use`

`@use(...guards)` attaches one or more guards to a whole controller (every route) or to a
single route.

```ts title="me.controller.ts"
import { Auth, controller, get, inject, use } from "turnover";
import { authenticate } from "./auth";

@controller("/me")
@use(authenticate) // runs before every route in this controller
export class MeController {
  private readonly auth = inject(Auth);

  @get("/")
  whoami() {
    return this.auth.user; // your app's Principal, or a 401 if not authenticated
  }
}
```

A `GET /me` without valid credentials never reaches `whoami()` — the `authenticate` guard
short-circuits it with a `401`.

## What a guard is

A `Guard` is `(ctx: Context) => void | Response | Promise<void | Response>`:

- **Return nothing** (`undefined`) to continue to the next guard, then the handler.
- **Return or throw a `Response`** to short-circuit — the handler never runs, and that
  `Response` is sent (after `ctx.set.headers` and any queued cookies are applied).

```ts title="guards.ts"
import type { Guard } from "turnover";

// Continue for GETs, block everything else with a 403.
export const readOnly: Guard = (ctx) =>
  ctx.req.method === "GET" ? undefined : new Response("Forbidden", { status: 403 });
```

Guards run broadest-first: module guards, then controller guards, then route guards. Any
one of them can short-circuit.

## Authenticate a request with `setPrincipal`

A guard authenticates by resolving the caller's identity — the **principal** — and calling
`setPrincipal(...)`. Once set, the principal is attached to the request for the rest of its
lifetime.

`Principal` ships as an empty interface; describe your user by augmenting it. The
`turnover/auth` module exists precisely as this augmentation target.

```ts title="auth.ts"
import { setPrincipal, type Guard } from "turnover";

declare module "turnover/auth" {
  interface Principal {
    id: string;
    name: string;
    roles: string[];
  }
}

const USERS: Record<string, Principal> = {
  tok_abc: { id: "u_1", name: "Ada", roles: ["admin"] },
};

export const authenticate: Guard = (ctx) => {
  const token = ctx.req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const user = token ? USERS[token] : undefined;
  if (!user) return new Response("Unauthorized", { status: 401 });
  setPrincipal(user); // Auth.user now resolves to this for the rest of the request
};
```

:::caution
`setPrincipal()` throws if called outside a request context. Call it from a guard,
deriver, or interceptor — never at module top level.
:::

## Read the principal with `Auth`

`Auth` is an injectable accessor for the current request's principal. Inject it with
`inject(Auth)` and read one of its getters:

- `auth.user` — the principal, or **throws a `401`** if the request isn't authenticated.
- `auth.optional` — the principal, or `null`.
- `auth.isAuthenticated` — a boolean.

```ts title="profile.controller.ts"
import { Auth, controller, get, inject } from "turnover";

@controller("/profile")
export class ProfileController {
  private readonly auth = inject(Auth);

  @get("/")
  show() {
    if (!this.auth.isAuthenticated) return { anonymous: true };
    return { id: this.auth.optional!.id };
  }
}
```

`Auth` is a plain **singleton**, yet every getter returns per-request data. It works because
request state lives in an `AsyncLocalStorage`: the getters read the *current* request's
principal at call time. That means you can inject `Auth` into a singleton controller or
service and still get the right user — no need to thread `ctx` through your call stack.

:::note
`auth.user` short-circuits by throwing a `Response`, not an `HttpError`. A thrown `Response`
passes straight through the error pipeline unchanged — see
[Error handling](/concepts/error-handling/).
:::

## Built-in auth decorators

Beyond writing your own guards, Turnover ships ready-made ones. `requireAuth` is a guard
value; the rest are decorators you apply directly.

```ts title="admin.controller.ts"
import {
  authenticated,
  authorize,
  controller,
  del,
  get,
  requireRole,
  type Context,
} from "turnover";

@controller("/admin")
@requireRole("admin") // 401 if anonymous, 403 if principal.roles lacks "admin"
export class AdminController {
  @get("/")
  dashboard() {
    return { ok: true };
  }

  @del("/users/:id")
  @authorize((user, ctx) => user.id === ctx.params.id) // ownership check
  remove(ctx: Context<{ id: string }>) {
    return { removed: ctx.params.id };
  }
}
```

- **`requireAuth`** — a guard value that returns `401` when no principal is set. Use it as
  `@use(requireAuth)`.
- **`@authenticated`** — sugar for `@use(requireAuth)`. Requires an authenticated principal.
- **`@requireRole(...roles)`** — allow only if `principal.roles` holds at least one of
  `roles`; otherwise `403` (or `401` if anonymous).
- **`@requireScope(...scopes)`** — same, but checks `principal.scopes`.
- **`@authorize(policy)`** — allow only when `policy(principal, ctx)` returns truthy. The
  generic escape hatch for ownership, tenancy, or any custom rule. `401` if anonymous, `403`
  if the policy rejects. The policy may be `async`.

All of these are class **or** method decorators, and they stack — a controller-wide
`@requireRole("admin")` combines with a per-route `@authorize(...)`.

## The `authentication()` plugin

Rather than putting `setPrincipal` in a guard on every controller, you can run
authentication once, globally, for every request. The `authentication(schemes)` plugin takes
a list of schemes, tries them in order, and the first to resolve a principal wins — it's
attached to the request so `inject(Auth).user`, `@authenticated`, and `@requireRole` all see
it. A request no scheme recognizes is simply anonymous.

```ts title="server.ts"
import { apiKey, authentication, bearer, createApp } from "turnover";

const app = await createApp({
  plugins: [
    authentication([
      bearer({ verify: (token) => lookupByToken(token) }),   // Authorization: Bearer <token>
      apiKey({ verify: (key) => lookupByKey(key) }),          // x-api-key: <key>
    ]),
  ],
});
```

- **`bearer({ verify, scheme? })`** — reads `Authorization: Bearer <token>` (customize the
  scheme word via `scheme`) and calls `verify(token)`.
- **`apiKey({ verify, header? })`** — reads a key from a header (default `x-api-key`) and
  calls `verify(key)`.

Each `verify` returns the `Principal` on success, or `null` to **defer** — it does *not*
reject. There is no reject signal: a `null` just means "not my credential," so the next
scheme is tried, and if none resolves a principal the request is simply left **anonymous**.
Turning that anonymous request into a `401` is a route guard's job (`@authenticated`,
`@requireRole`, …). Implement the `AuthScheme` interface yourself for any other credential
type.

## Next steps

- [Deriving request context](/concepts/deriving-context/) — compute per-request values
  before guards run, so guards can read them.
- [The request lifecycle](/concepts/the-request-lifecycle/) — exactly where guards sit in
  the per-request pipeline.
- [Error handling](/concepts/error-handling/) — how thrown `Response`s and `HttpError`s
  become the responses your guards return.
