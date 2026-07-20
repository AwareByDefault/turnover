---
title: Method advice
description: Wrap any injectable service method with cross-cutting logic using @before / @after / @around, and the container post-processor seam it is built on.
sidebar:
  order: 12
---

[Interceptors](/concepts/interceptors/) wrap HTTP handlers. **Method advice**
goes deeper: it wraps *any* method on *any* injectable — a service, a repository,
a config object — with cross-cutting logic like logging, timing, retry, caching,
or transactions. It is the same AOP idea applied to your domain code, not just
your routes.

```ts title="orders.service.ts"
import { injectable, before, after, around } from "turnover";

@injectable()
export class Orders {
  @before((jp) => console.log(`→ ${jp.method}`, jp.args))
  @around((jp) => {
    const started = performance.now();
    const result = jp.proceed(); // run the wrapped method
    console.log(`${jp.method} took ${performance.now() - started}ms`);
    return result;
  })
  place(order: Order) {
    // ...
  }
}
```

Any code that calls `orders.place(...)` through the injected instance runs the
advice around the real method.

## The seam: container post-processors

Advice is built on a low-level hook called a **post-processor**. After the
container constructs an instance, it runs each post-processor, which inspects the
instance and returns it — either unchanged, or wrapped (typically in a `Proxy`):

```ts title="post-processor.ts"
type PostProcessor = (instance: object, token: Ctor) => object;
```

Register one with `container.addPostProcessor(fn)` or
`createApp({ postProcessors: [fn] })`. Post-processors **chain** in registration
order (each sees the previous one's output), and the resulting wrapper is
**cached** as that instance — so callers who inject it always get the wrapped
version.

```ts title="server.ts"
const app = await createApp({
  postProcessors: [
    (instance, token) => {
      // return `instance`, or a Proxy/wrapper around it
      return instance;
    },
  ],
});
```

`createApp` registers the built-in post-processors for you (advice, events,
transactions, caching, scheduling), so most apps never write one directly.

:::caution[Self-invocation bypasses advice]
Advice is applied by the wrapper, so it only fires on calls that go *through* the
injected instance. When a method calls **another method on `this`**, that inner
call reaches the raw, unwrapped object and is **not** advised. Split methods
across collaborators (and inject them) if you need advice on the inner call.
:::

## `@before` / `@after` / `@around`

Attach advice to any method of an `@injectable` (or `@service` / `@repository`)
class:

- `@before(advice)` — runs before the method (sync side effects).
- `@after(advice)` — runs after the method, in a `finally` (so it runs even if
  the method throws); async methods are awaited first.
- `@around(advice)` — wraps the call; you decide whether and when to run it.

`@before` and `@after` receive a **`JoinPoint`**; `@around` receives a
**`ProceedingJoinPoint`** that adds `proceed()`:

```ts title="join-point.ts"
interface JoinPoint {
  readonly target: object;         // the (unwrapped) instance
  readonly method: string;         // the method name
  readonly args: readonly unknown[]; // the call arguments
}

interface ProceedingJoinPoint extends JoinPoint {
  proceed(args?: unknown[]): unknown; // run the method (optionally with new args)
}
```

An `@around` advice can transform arguments (`jp.proceed([...newArgs])`),
transform the return value, short-circuit (never call `proceed()`), or catch and
recover from an error.

### Ordering

When a method carries several advices, they run in a fixed order regardless of
the order you *wrote* the decorators:

1. `@before` advices run first.
2. `@around` advices wrap the call — the **top-most** `@around` is the
   outermost, so its code runs first on the way in and last on the way out.
3. The method itself runs.
4. `@after` advices run last (in a `finally`; async results are awaited before
   they fire).

## Built-in advice: transactions

`@transactional` runs a method inside the bound `TransactionManager` — commit on
success, roll back if it throws:

```ts title="orders.service.ts"
import { injectable, transactional } from "turnover";

@injectable()
export class Orders {
  @transactional
  async place(order: Order) {
    // ...runs in a transaction; rolls back if this throws
  }
}
```

Bind your database's manager as a provider:

```ts title="server.ts"
import { createApp, TRANSACTION_MANAGER, type TransactionManager } from "turnover";

const manager: TransactionManager = {
  run: (fn) => db.transaction(fn),
};

const app = await createApp({
  providers: [{ provide: TRANSACTION_MANAGER, useValue: manager }],
});
```

With **no** manager bound, the default just runs the method as-is — a synchronous
method stays synchronous, so `@transactional` is safe to leave on code that runs
before you have a database wired up. `@repository` is shorthand for `@injectable`
plus `@transactional` on **every** method of the class.

:::note
When a real manager *is* bound, `manager.run(...)` returns a `Promise`, so a
`@transactional` method resolves through it — `await` its result.
:::

## Built-in advice: caching

`@cacheable` memoizes a method's result by its arguments; `@cacheEvict` clears
the cache when called:

```ts title="pricing.service.ts"
import { injectable, cacheable, cacheEvict } from "turnover";

@injectable()
export class Pricing {
  @cacheable({ ttl: 60_000 }) // cache for 60s, keyed by the arguments
  async quote(sku: string) {
    return await lookupPrice(sku);
  }

  @cacheEvict // clear the cache when a price changes
  async refresh() {
    // ...
  }
}
```

`@cacheable` options:

- `key` — key prefix (default: the method name).
- `ttl` — time-to-live in milliseconds (default: no expiry).
- `keyBy(...args)` — derive the key suffix from the arguments (default: the JSON
  of the arguments).

The default backend is an in-memory `MemoryCache`. Swap it by binding
`CACHE_STORE` to any `CacheStore` (for example a Redis-backed one):

```ts title="server.ts"
import { createApp, CACHE_STORE } from "turnover";

const app = await createApp({
  providers: [{ provide: CACHE_STORE, useValue: myRedisCacheStore }],
});
```

:::note
Because the cache store is async, a `@cacheable` method **always returns a
`Promise`** — `await` it even when the method body is synchronous. `@cacheEvict`
clears the **entire** store, not just this method's entries.
:::

## Building custom advice

The same seam is public, so you can build your own decorators. Get a class's
metadata bag from a decorator context with `decoratorMeta(context)`, then push
around-advice onto named methods with `addAround(meta, method, advice)`:

```ts title="timed.ts"
import { addAround, decoratorMeta, type ProceedingJoinPoint } from "turnover";

/** Class decorator: time the named methods (built on the same seam as @around). */
export function timed(...methods: string[]) {
  return (_cls: unknown, context: ClassDecoratorContext) => {
    const meta = decoratorMeta(context);
    for (const name of methods) {
      addAround(meta, name, (jp: ProceedingJoinPoint) => {
        const started = performance.now();
        const result = jp.proceed();
        console.log(`${jp.method}: ${performance.now() - started}ms`);
        return result;
      });
    }
  };
}
```

To read a *constructed* class's metadata from inside a post-processor (the read
side), use `classMeta(token)`, which returns the bag attached to the class (or
`undefined` if it carries none). Together, `decoratorMeta` (write, at decoration
time) and `classMeta` (read, at construction time) are enough to build advice,
markers, and plugins on the AOP seam.

## Next steps

- [Dependency injection](/concepts/dependency-injection/) — how instances are
  constructed and where post-processors fit in.
- [Interceptors](/concepts/interceptors/) — the request-scoped counterpart that
  wraps HTTP handlers.
