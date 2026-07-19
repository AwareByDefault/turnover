---
"turnover": minor
---

Add `rateLimit()` — request rate limiting.

- **`rateLimit({ limit, windowMs })`** is a plugin that limits how many requests a client may make in a time window, replying `429 Too Many Requests` (with `Retry-After`) once the limit is exceeded; every response carries `X-RateLimit-Limit` / `X-RateLimit-Remaining`.
- Bucket clients with `keyBy(ctx)` (default: the `X-Forwarded-For` header, else a shared bucket). The default counter is an in-memory fixed window; swap in a shared `store` (e.g. Redis) for a multi-instance deployment. Exposes `rateLimit`, `memoryRateLimitStore`, `RateLimitOptions`, and `RateLimitStore`.
