---
'turnover': minor
---

Add `session()` — cookie-based sessions backed by a pluggable `SessionStore`.
The plugin loads the session named by the id cookie, exposes it through the
injectable `Session` accessor (`get`/`set`/`delete`/`clear`/`regenerate`/
`destroy`), and persists changes afterwards: sessions are created lazily (an
anonymous request that never writes gets no cookie and no store entry), the
`HttpOnly` `SameSite=Lax` cookie is set on first write and expired on
`destroy()`, and `regenerate()` rotates the id post-authentication to defend
against fixation. Ships `memorySessionStore({ ttl? })`; the async `SessionStore`
interface lets a shared backend (Redis, a database) drop in. Pairs with a
`@derive` that maps the session to `setPrincipal(...)` for authorization.
