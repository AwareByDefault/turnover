---
title: Macros
description: Bundle guards, derivers, interceptors, and error handlers into one named, DI-resolvable decorator you apply with @macro.
sidebar:
  order: 14
---

A macro is a **named, parameterized, DI-resolvable bundle of cross-cutting** — any mix of
guards, derivers, interceptors, and error handlers — that you apply to a controller or
route with a single decorator. Define it once, then opt in with `@macro(name, ...args)`.

## A first macro

Register a macro with `defineMacro`, then apply it:

```ts title="admin.controller.ts"
import { defineMacro, macro, inject, Auth, controller, get } from "turnover";

defineMacro("role", (required: string) => {
  const auth = inject(Auth); // resolved at mount — the DI + cross-cutting fusion
  return {
    use: [
      () =>
        auth.user.roles.includes(required)
          ? undefined
          : new Response("Forbidden", { status: 403 }),
    ],
  };
});

@controller("/admin")
export class AdminController {
  @get("/users")
  @macro("role", "admin") // one line replaces a guard (and derive/intercept/…)
  listUsers() {
    /* ... */
  }
}
```

A request to `GET /admin/users` now runs the macro's guard: it passes for an admin and
returns `403 Forbidden` otherwise.

## The factory runs in an injection context

`defineMacro(name, factory)` stores a factory keyed by `name`. The factory receives the
arguments you pass to `@macro(name, ...args)` and returns a `MacroHooks` bundle. Registration
is process-global, and re-registering the same `name` replaces the previous factory — the
last `defineMacro` for a name wins.

The key detail: **the factory is invoked in an injection context at mount time**, so it can
`inject()` services and close over them in the hooks it returns. In the example above,
`inject(Auth)` resolves while the app is mounting, and the returned guard captures `auth`.
This is what makes a macro "DI-resolvable" — the guard it produces already has its
dependencies wired in, without a parameter decorator or a constructor.

:::tip
Because the factory runs at mount, injecting a **request-scoped** service (like `Auth`)
hands you a proxy that resolves to the current request's instance each time a hook reads
it. You get the right per-request value even though the factory ran once, at boot.
:::

## What a macro can contribute

A macro returns a `MacroHooks` object — the same four cross-cutting kinds that `@use`,
`@derive`, `@intercept`, and `@catchError` attach individually:

```ts title="MacroHooks"
interface MacroHooks {
  use?: Guard[]; // guards, like @use
  derive?: Deriver[]; // context derivers, like @derive
  intercept?: Interceptor[]; // around-advice, like @intercept
  catchError?: ErrorHandler[]; // error handlers, like @catchError
}
```

Every field is optional — a macro may contribute just a guard, or a guard plus a deriver
plus an error handler, in one bundle. Whatever it returns is applied to the route exactly
as if you had written the corresponding decorators by hand.

## Applying and composing

`@macro(name, ...args)` works on a **class or a method**. Both levels apply, and multiple
`@macro` decorators compose — their hooks are merged, so you can stack a controller-wide
macro with a per-route one:

```ts title="orders.controller.ts"
import { macro, controller, get, post } from "turnover";

@controller("/orders")
@macro("tenant") // applies to every route in the controller
export class OrdersController {
  @get("/")
  list() {
    /* just the class-level macro */
  }

  @post("/")
  @macro("role", "manager") // class macro + this method macro both apply
  create() {
    /* ... */
  }
}
```

:::caution
`@macro("name")` is resolved by name at mount time. If no macro with that name was
registered, mounting throws `Unknown macro "name"`. Make sure the module that calls
`defineMacro(...)` is imported before the app mounts — put your `defineMacro` calls in a
file that runs during startup.
:::

## Next steps

- [Guards and auth](/concepts/guards-and-auth/) — the guards a macro's `use` bundle contributes.
- [Deriving context](/concepts/deriving-context/) — the derivers a macro can add.
- [Interceptors](/concepts/interceptors/) — the around-advice a macro can wrap a route with.
