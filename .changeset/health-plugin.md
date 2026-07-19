---
"turnover": minor
---

Add `health()` — liveness and readiness probes.

- **`health()`** is a plugin that mounts two probe endpoints. `/health` answers `200 {status:"up"}` whenever the process is serving (liveness). `/ready` runs every registered check and answers `200` when all pass or `503` when any fails (readiness), with a per-check breakdown — the shape a load balancer or orchestrator expects.
- Checks are `{ name, check: () => boolean | Promise<boolean> }`; a falsy result or a throw marks a check down. Probe paths are configurable (`livenessPath`/`readinessPath`). Served via an `onRequest` short-circuit, so no controller is needed and other routes are untouched.
- Exposes `health`, `HealthCheck`, and `HealthOptions`.
