---
'turnover': minor
---

Add a `turnover/redis` subpath with `redisSessionStore()` and `redisOtpStore()`
— Redis-backed adapters for the async `SessionStore` and `OtpStore`, so sessions
and passwordless codes survive restarts and are shared across replicas. Both are
dependency-free: you pass any client satisfying a small four-method `RedisClient`
interface (Bun's built-in redis, ioredis, node-redis, …) — turnover never
imports a Redis library. Session writes take an optional TTL; OTP entries get a
Redis TTL matching each code's own expiry.
