---
'turnover': minor
---

Add `Passwordless` — passwordless authentication via one-time codes (email OTP
or magic-link tokens). `issue()` a code for an identifier and send it yourself
(e.g. with `Mailer`); `verify()` the submitted code. Codes are stored only as
SHA-256 hashes, expire after a configurable `ttl`, are single-use (consumed on
success, constant-time comparison), and burn after `maxAttempts` wrong tries.
Supply a `generateCode` for long URL-safe magic-link tokens instead of numeric
OTPs. Pluggable `OtpStore` with an in-memory default.
