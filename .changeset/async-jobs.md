---
'turnover': minor
---

Make `JobStore` async so a durable backend can back `JobQueue`, and ship
`redisJobStore()` at `turnover/redis`. Its methods return promises,
`memoryJobStore` implements the async shape, and `JobQueue.enqueue`, `failed`,
and `pending` now return promises.

Breaking (pre-1.0): `await queue.enqueue(...)`, `await queue.failed()`, and
`await queue.pending()`; custom `JobStore` implementations must return promises.
`redisJobStore(client)` stores the job set in one Redis hash (a small
`hset`/`hgetall`/`hdel` client) — durable, shared across replicas, with
completed jobs pruned. Previously deferred for the sync-interface constraint —
now unblocked.
