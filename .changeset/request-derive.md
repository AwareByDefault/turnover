---
"turnover": minor
---

Add `@derive` for request-scoped context.

- **`@derive(...derivers)`** (controller or route) runs before guards to compute per-request values. A deriver returns an object to merge into `ctx.store`, writes `ctx.store` directly, or throws (e.g. an `HttpError`) to abort.
- **`ctx.store`** holds those values; augment the `RequestStore` interface to type it. Injected singletons can read the same store via **`getRequestStore()`** without a `ctx`.
- Per-request ordering is now **derivers → guards → validation → handler**; class-level derivers run before method-level ones. The store is isolated per request via `AsyncLocalStorage`.
- Exposes `derive`, `Deriver`, `RequestStore`, and `getRequestStore`.
