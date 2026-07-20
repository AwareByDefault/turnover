---
title: Deriving request context
description: Use @derive to compute per-request values before guards run and @resolve to compute them after validation, storing both on the typed ctx.store readable from anywhere.
sidebar:
  order: 8
---

`@derive` and `@resolve` compute per-request values and stash them on `ctx.store`, so guards,
handlers, and even injected singletons can read them without recomputing.

## Derive values before guards

`@derive(...)` runs functions **before guards** to populate `ctx.store`. Return an object to
merge into the store, or write `ctx.store` directly. Throwing aborts the request.

```ts title="orders.controller.ts"
import { controller, derive, get, type Context } from "turnover";

declare module "turnover/request" {
  interface RequestStore {
    tenant: string;
  }
}

@controller("/orders")
@derive((ctx) => ({ tenant: ctx.req.headers.get("x-tenant") ?? "public" }))
export class OrdersController {
  @get("/")
  list(ctx: Context) {
    return { tenant: ctx.store.tenant }; // => { "tenant": "acme" }
  }
}
```

Because derivers run *before* guards, a guard can read the derived value — for example a
`requireTenant` guard that rejects when `ctx.store.tenant` is `"public"`.

## Type the store

`RequestStore` ships empty; augment it (via the `turnover/request` module) to describe what
your derivers add. Then `ctx.store.tenant` is fully typed everywhere. Add one field per
derived value:

```ts
declare module "turnover/request" {
  interface RequestStore {
    tenant: string;
    session: Session;
  }
}
```

## Read the store from a singleton

Anything on the store is also reachable from injected singleton services via
`getRequestStore()` — no `ctx` needed. Like the [`Auth` accessor](/concepts/guards-and-auth/),
it reads the *current* request's store through `AsyncLocalStorage`.

```ts title="tenant.service.ts"
import { getRequestStore, injectable } from "turnover";

@injectable()
export class TenantService {
  current(): string {
    return getRequestStore()?.tenant ?? "public";
  }
}
```

`getRequestStore()` returns `undefined` when called outside a request.

## Resolve values after validation

`@resolve(...)` is like `@derive`, but runs **after** guards and validation — so it can read
`ctx.valid`. Use it to load something named by a now-validated input, e.g. fetch the entity
for a validated `:id`.

```ts title="orders.controller.ts"
import { controller, get, resolve, type Context } from "turnover";
import { z } from "zod";

const Params = z.object({ id: z.string().uuid() });

declare module "turnover/request" {
  interface RequestStore {
    order: Order;
  }
}

@controller("/orders")
export class OrdersController {
  @get("/:id", { params: Params })
  @resolve(async (ctx) => {
    const { id } = ctx.valid.params as z.infer<typeof Params>; // safe: already validated
    return { order: await db.orders.get(id) };
  })
  show(ctx: Context) {
    return ctx.store.order;
  }
}
```

## Order of execution

Per request, the pipeline runs in this fixed order:

**derivers → guards → validation → resolvers → handler**

Within derivers (and within resolvers), **class-level** functions run before **method-level**
ones. That means a controller-wide `@derive` populates the store before a route's own
`@derive` sees it.

:::note
The difference between `@derive` and `@resolve` is *when* they run. Choose `@derive` for
values you need before auth (a tenant, a session); choose `@resolve` for values that depend
on validated input (`ctx.valid`).
:::

## Next steps

- [Guards & auth](/concepts/guards-and-auth/) — guards run after derivers, so they can read
  `ctx.store`.
- [Validation](/concepts/validation/) — resolvers run after it, so they can read
  `ctx.valid`.
- [The request lifecycle](/concepts/the-request-lifecycle/) — the complete per-request
  ordering, end to end.
