---
"turnover": minor
---

Add `securityHeaders()` — a baseline of security response headers.

- **`securityHeaders()`** is a plugin that sets a helmet-style default on every response: `Content-Security-Policy` (`default-src 'self'`), `Strict-Transport-Security`, `X-Frame-Options` (`DENY`), `Referrer-Policy` (`no-referrer`), `Cross-Origin-Opener-Policy` (`same-origin`), and `X-Content-Type-Options` (`nosniff`).
- Each header is overridable, or set to `false` to omit it. It never clobbers a header a handler already set. Exposes `securityHeaders` and `SecurityHeadersOptions`.
