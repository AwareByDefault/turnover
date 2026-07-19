---
"turnover": minor
---

Add `@transactional` and `@cacheable` / `@cacheEvict` — declarative transactions and caching on the method-AOP mechanism.

- **`@transactional`** runs a method inside the bound `TransactionManager` (commit on success, roll back on throw); the method's result becomes a `Promise`. Bind your database's manager via `{ provide: TRANSACTION_MANAGER, useValue }`; the default just runs the method.
- **`@cacheable(options?)`** memoizes a method's result by its arguments (async results cached once resolved). Options: `key`, `ttl` (ms), and `keyBy(...args)`. **`@cacheEvict`** clears the cache when the method is called. Uses an in-memory `MemoryCache` by default; bind `CACHE_STORE` to swap it (e.g. Redis).
- Both are container-bound post-processors `createApp` auto-registers; caching sits outside transactions (a cache hit skips the transaction). Exposes `transactional`, `TransactionManager`, `TRANSACTION_MANAGER`, `cacheable`, `cacheEvict`, `CacheStore`, `CACHE_STORE`, and `MemoryCache`.
