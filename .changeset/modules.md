---
"turnover": minor
---

Add `@module` for composing controllers into prefixed, nestable units.

- **`@module({ prefix, controllers, modules, use, derive, catchError })`** groups controllers under a shared path prefix and shares its cross-cutting concerns — guards (`use`), derivers (`derive`), and error handlers (`catchError`) — with every controller it mounts and with any nested `modules`.
- Mount modules via **`createApp({ modules: [...] })`**; they can be combined with explicit `controllers`. Prefixes compose across nesting (`/admin` → `/admin/billing` → controller base → route).
- Import cycles are broken automatically (recursion-stack guard), while a shared module can still be mounted under several parents (a diamond).
- Exposes `module` and `ModuleOptions`.
