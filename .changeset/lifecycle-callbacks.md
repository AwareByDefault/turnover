---
"turnover": minor
---

Add `@postConstruct` / `@preDestroy` bean lifecycle callbacks.

- **`@postConstruct`** (method decorator) runs right after the container constructs a service (once field initializers have run). Sync hooks run inline; **async hooks are awaited at bootstrap** via `container.init()`, which `createApp` now calls after mounting — so a service that opens a pool/connection is ready before you serve.
- **`@preDestroy`** (method decorator) runs when the app stops: `app.stop()` now calls `container.dispose()`, invoking `@preDestroy` hooks in **reverse construction order**. A failing hook is logged and doesn't stop the others.
- Exposes `postConstruct`, `preDestroy`, and the `Container.init()` / `Container.dispose()` methods.
