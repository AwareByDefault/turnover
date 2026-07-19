---
'turnover': minor
---

Add `Mailer` — a transport-agnostic email sender. Normalizes and validates a
`Mail` (recipient fields to arrays, default `from`, at least one recipient and a
`text`/`html` body) then hands it to a pluggable `MailTransport`. Ships
`memoryTransport()` (captures messages for tests and dev); plug an SMTP or API
transport in production. Zero runtime dependencies — real transports stay the
consumer's choice.
