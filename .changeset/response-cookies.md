---
"turnover": minor
---

Add response control and cookies to the request context.

- **`ctx.set`** — set the status of a coerced return value (`ctx.set.status`) and merge headers onto the response (`ctx.set.headers`, a `Headers`). A returned `Response` keeps its own status; `set.headers` still merge onto it, preserving its existing headers.
- **`ctx.cookies`** — read incoming cookies (`get` / `has` / `all`) and queue outgoing ones (`set(name, value, options)` / `delete(name, options?)`) with the usual attributes (`path`, `domain`, `expires`, `maxAge`, `httpOnly`, `secure`, `sameSite`, `partitioned`). Values are URL-encoded/decoded.
- `set.headers` and cookies are applied to **every** response — coerced values, returned `Response`s, guard short-circuits, and error responses alike.
- Exposes `Cookies`, `CookieOptions`, and `ResponseState`.
