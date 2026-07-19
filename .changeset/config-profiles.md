---
"turnover": minor
---

Add configuration/environment injection and profiles.

- **`Config`** service + **`value(key, fallback)`** / **`requireValue(key)`** helpers read configuration, coercing to the fallback's type (`string`/`number`/`boolean`). Reads `Bun.env` by default; override with **`createApp({ config })`** (a plain object or a `ConfigSource`) or a `CONFIG_SOURCE` provider. `Config` also has `require`/`has`.
- **Profiles**: set active profiles via `createApp({ profiles })` (defaults from `TURNOVER_PROFILES` or `NODE_ENV`). **`@profile(...names)`** mounts a controller or module only when one of its profiles is active; `Config.hasProfile(name)` reads them.
- Adds **`Container.resolveOptional(token, fallback)`** / **`injectOptional(token, fallback)`** (return a fallback when an `InjectionToken` is unbound), used by `Config`.
- Exposes `Config`, `ConfigSource`, `EnvConfigSource`, `CONFIG_SOURCE`, `ACTIVE_PROFILES`, `value`, `requireValue`, `profile`, and `injectOptional`.
