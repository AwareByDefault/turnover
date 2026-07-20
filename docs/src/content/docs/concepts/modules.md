---
title: Modules
description: Group controllers into mountable, prefixed units with @module, share cross-cutting concerns across them, and compose modules by nesting.
sidebar:
  order: 13
---

A **module** groups controllers into a single mountable unit. It prepends a
shared path `prefix` to every route it mounts and applies shared cross-cutting
concerns — guards, derivers, interceptors, and error handlers — to all of them.
Modules also nest, so you can compose a whole app tree from smaller pieces.

```ts title="admin.module.ts"
import { module } from "turnover";
import { authenticate } from "./auth";
import { UsersController } from "./users.controller";
import { RolesController } from "./roles.controller";
import { BillingModule } from "./billing.module";

@module({
  prefix: "/admin",
  use: [authenticate],                         // guards for every route below
  derive: [(ctx) => ({ tenant: tenantOf(ctx) })],
  controllers: [UsersController, RolesController],
  modules: [BillingModule],                    // nested; inherits /admin + the guard
})
export class AdminModule {}
```

```ts title="server.ts"
import { createApp } from "turnover";
import { AdminModule } from "./admin.module";

const app = await createApp({ modules: [AdminModule] });
app.listen(3000);
// GET /admin/users, /admin/roles, /admin/billing/... — all behind `authenticate`
```

## What a module shares

`@module(options)` accepts:

| Field | Effect |
|---|---|
| `prefix` | Path prefix prepended to every route the module mounts. |
| `controllers` | Controllers mounted by this module. |
| `modules` | Nested modules, mounted under this prefix and cross-cutting. |
| `use` | Guards applied before every route in the module (and nested modules). |
| `derive` | Derivers run before every route in the module (and nested modules). |
| `intercept` | Interceptors wrapping every route in the module (and nested modules). |
| `catchError` | Error handlers for every route in the module (and nested modules). |

Every field is optional — `@module()` with no options is a valid (if empty)
module. The cross-cutting lists compose the same way they do on controllers: a
module's guards run before its controllers' guards, its interceptors wrap the
controller and route interceptors, and its error handlers are tried after the
more specific ones. See [Guards & auth](/concepts/guards-and-auth/) and
[Interceptors](/concepts/interceptors/) for those chains.

## Nesting and prefix composition

Nested modules inherit their parent's prefix *and* its cross-cutting concerns.
Prefixes compose by concatenation across the whole nesting, and each controller
adds its own base on top:

```ts title="billing.module.ts"
@module({
  prefix: "/billing",
  controllers: [InvoicesController], // @controller("/invoices")
})
export class BillingModule {}
```

Mounted as `modules: [AdminModule]` above, `InvoicesController`'s routes land at
`/admin` + `/billing` + `/invoices` — e.g. `GET /admin/billing/invoices`. The
`authenticate` guard and `tenant` deriver from `AdminModule` apply to them too,
because `BillingModule` is nested inside it.

## Combining modules and controllers

`modules` and `controllers` can appear together in one `createApp` — the modules
mount under their prefixes, and the loose controllers mount at their own bases:

```ts title="server.ts"
const app = await createApp({
  modules: [AdminModule],
  controllers: [HealthController], // mounts at its own @controller base, no prefix
});
```

## Import cycles and shared modules

Modules reference each other by importing classes, so two modules that reference
each other would form an import cycle. Turnover **breaks these cycles
automatically** while expanding the module tree, so you can wire modules together
without hand-managing import order.

A single module can also be mounted under **several** parents. Each mount point
applies its own prefix and cross-cutting concerns, so the same
`BillingModule` could appear under both an `/admin` tree and a `/self-serve`
tree, producing distinct route sets from one definition.

## Next steps

- [Controllers & routing](/concepts/controllers-and-routing/) — the controllers a
  module mounts, and how route paths are built.
- [Guards & auth](/concepts/guards-and-auth/) — the guards a module shares across
  its routes.
- [Dependency injection](/concepts/dependency-injection/) — how the controllers
  inside a module get their services.
