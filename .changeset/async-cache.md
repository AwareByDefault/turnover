---
'turnover': minor
---

Make `CacheStore` async so a shared backend can back `@cacheable`, and ship
`redisCacheStore()` at `turnover/redis`. `CacheStore.get`/`set`/`delete`/`clear`
now return promises, `MemoryCache` implements the async shape, and a `@cacheable`
(or `@cacheEvict`) method now always returns a `Promise` — `await` it even when
the body is synchronous.

Breaking (pre-1.0): callers of `@cacheable` methods must add `await`, and custom
`CacheStore` implementations must return promises. `redisCacheStore(client)`
takes any client with `get`/`set`/`del`/`expire`/`keys`; `clear()` removes only
the store's prefixed keys.
