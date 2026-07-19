---
'turnover': minor
---

Add `JobQueue` — an in-process background job queue with retries, exponential
backoff, delays, and a dead-letter list. Register a handler per job `type`,
`enqueue()` work, and drain it either deterministically with `process()` (ideal
in tests, via an injectable clock) or by letting `start()` poll on an interval.
A throwing handler reschedules with backoff until its attempts are exhausted,
then lands in `failed()`. Storage is pluggable (`JobStore`) with an in-memory
default.
