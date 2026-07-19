---
'turnover': minor
---

Add `csrf()` — CSRF protection via the double-submit-cookie pattern. Safe
requests mint a random, `SameSite=Strict`, JS-readable token cookie; unsafe
requests must echo it in a matching header (default `x-csrf-token`) or get
`403 Forbidden`. Cookie name, header name, safe-method set, and cookie
attributes are configurable.
