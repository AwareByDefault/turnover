---
"turnover": minor
---

Add scheduled tasks (`@scheduled`) and stereotype aliases (`@service` / `@repository`).

- **`@scheduled({ interval, runOnStart? })`** runs a service method on a fixed interval while the app is listening — started by `app.listen()`, cleared by `app.stop()`. `runOnStart` also runs it once at startup; a failing run is logged, not propagated. The service must be constructed (inject it, or list it in `createApp({ listeners })`). For cron expressions, layer an external cron library over the same methods. Exposes `scheduled`, `Scheduler`, `ScheduledOptions`, and `schedulingProcessor`.
- **`@service()`** and **`@repository()`** are stereotype aliases of `@injectable()` (service-layer and persistence components).
