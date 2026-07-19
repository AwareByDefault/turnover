---
"turnover": minor
---

Add authorization decorators — `@authenticated`, `@requireRole`, `@requireScope`, `@authorize`.

- **`@authenticated`** (class or method) requires an authenticated principal, else `401` — sugar for `@use(requireAuth)`.
- **`@requireRole(...roles)`** / **`@requireScope(...scopes)`** require the principal to hold at least one of the given roles/scopes (on `principal.roles` / `principal.scopes`), else `403` (or `401` if unauthenticated).
- **`@authorize((principal, ctx) => boolean | Promise<boolean>)`** is the generic escape hatch — ownership, tenancy, or any policy; `403` when it rejects.
- All read the principal that authentication set, so access rules live on the controller next to the code they guard (class-level authentication runs before method-level authorization). Exposed from the barrel and `turnover/auth`.
