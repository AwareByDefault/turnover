---
title: Dependency injection
description: Declare injectable services, resolve them with inject(), and control their scope and lifecycle.
sidebar:
  order: 2
---

Turnover ships a first-class DI container. Mark a class `@injectable()` and pull it in with
`inject(Token)` in a **field initializer** — no constructor parameter decorators (standard
decorators don't have them). While the container constructs an object it sets an ambient
reference, which is what lets `inject()` find the right container.

```ts title="greeting.service.ts"
import { injectable } from "turnover";

@injectable() // default scope: "singleton"
export class GreetingService {
  private count = 0;
  greet(name: string) {
    return `Hello, ${name}! (#${(this.count += 1)})`;
  }
}
```

```ts title="users.controller.ts"
import { controller, get, inject } from "turnover";
import { GreetingService } from "./greeting.service";

@controller("/users")
export class UsersController {
  private readonly greeter = inject(GreetingService); // resolved at construction
  @get("/") hi() { return { msg: this.greeter.greet("world") }; }
}
```

Controllers are constructed through the same container, so they can inject services directly.

:::caution
`inject()` only works **while the container is constructing** an `@injectable` or
`@controller` — i.e. inside a field initializer or constructor. Calling it at module top
level throws with an explanatory error.
:::

## Stereotypes

Three class decorators mark a class injectable:

- **`@injectable(options?)`** — the base decorator.
- **`@service`** — an alias of `@injectable`, for a service-layer component.
- **`@repository(options?)`** — injectable **and** transactional: every instance method runs
  inside the bound `TransactionManager` (commit on success, roll back on throw). With no
  manager bound, methods pass through unchanged. See [Method advice](/concepts/method-advice/).

All three accept `{ scope? }`.

## Resolving

Inside a construction context, three helpers read from the container:

- **`inject(Token)`** — resolve one binding (or auto-construct a class token).
- **`injectAll(Token)`** — resolve **every** binding for a token (multi-inject).
- **`injectOptional(Token, fallback)`** — resolve, or return `fallback` when an
  `InjectionToken` has no binding.

## Scopes

Set a scope with `@injectable({ scope })`:

| Scope | Behavior |
| ----- | -------- |
| `"singleton"` *(default)* | Constructed once, cached, and shared. |
| `"transient"` | A new instance on every resolve. |
| `"request"` | One instance per request. Injected as a **Proxy** that resolves the current request's instance — so it works even when injected into a longer-lived singleton. Outside a request it falls back to a fresh transient. |

```ts
@injectable({ scope: "request" })
class RequestContextService { /* one per request */ }
```

## Tokens & providers

A concrete class is its own token — the container just constructs it. For anything that isn't
a class (an interface, a config value, a third-party object, a mock), create an
`InjectionToken<T>` and bind it with a **provider**:

```ts title="server.ts"
import { InjectionToken, createApp } from "turnover";

interface Logger { info(msg: string): void }
const LOGGER = new InjectionToken<Logger>("Logger");

const app = await createApp({
  controllers: [/* ... */],
  providers: [
    { provide: LOGGER, useValue: console },                  // a value / mock
    { provide: Database, useClass: PostgresDatabase },       // bind an interface to an impl
    { provide: CACHE, useFactory: (c) => new Cache(c.resolve(CONFIG)) }, // built with deps
    { provide: STORE, useExisting: CACHE },                  // alias → same instance
  ],
});
```

The four provider shapes:

| Provider | Meaning |
| -------- | ------- |
| `{ useValue }` | Use this exact value. |
| `{ useClass, scope? }` | Construct this class (optionally at a given scope). |
| `{ useFactory: (container) => T, scope? }` | Call the factory; a `"singleton"` factory result is cached. |
| `{ useExisting }` | Alias to another token — the same instance. |

Then `inject(LOGGER)` anywhere in a construction context.

### Overrides & multi-inject

Registering a token more than once **stacks** the bindings:

- `resolve()` / `inject()` return the **last** registration — so a test or a later provider
  can shadow an earlier one (great for mocks).
- `resolveAll()` / `injectAll()` return **every** binding — the basis for multi-inject
  collections (e.g. a set of health checks).

You can also register imperatively on a live container:

```ts
app.container.register(LOGGER, { useValue: silentLogger });
```

## Lifecycle callbacks

Two method decorators hook into a service's life:

- **`@postConstruct`** runs right after construction (once field initializers have run).
  Sync hooks run inline; **async hooks are awaited during `createApp`**, so a service is fully
  initialized before you serve.
- **`@preDestroy`** runs on `app.stop()`, in **reverse** construction order.

```ts
@injectable()
class Db {
  private pool!: Pool;
  @postConstruct async connect() { this.pool = await createPool(); }
  @preDestroy    async close()   { await this.pool.end(); }
}
```

:::note
Lifecycle tracking applies to **singletons** only — transient and request-scoped beans are
short-lived, so tracking them would leak.
:::

## Circular dependencies

A cycle in construction (A injects B injects A) is **detected and thrown** with a message
telling you to break the cycle or resolve one side lazily inside a method rather than in a
field initializer.

## Next steps

- [Configuration](/concepts/configuration/) — `value()`, `Config`, and `@configProperties`, all built on the container.
- [Method advice](/concepts/method-advice/) — `@before`/`@after`/`@around` and the post-processor seam DI advice is built on.
- [Controllers & routing](/concepts/controllers-and-routing/) — how injected services power your route handlers.
