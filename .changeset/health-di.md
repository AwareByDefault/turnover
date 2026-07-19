---
'turnover': minor
---

`health()` now auto-collects readiness checks from the container. Bind a
`HealthCheck` (a value or an `@injectable` class that implements it) to the new
`HEALTH_CHECK` multi-injection token and `/ready` aggregates every one alongside
any passed explicitly — so an indicator can `inject()` its own dependencies
instead of being wired by hand. Enabled by a new optional `onInit(container)`
plugin hook, which runs once at registration (after providers are bound) so any
plugin can resolve DI-registered collaborators.
