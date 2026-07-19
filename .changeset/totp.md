---
'turnover': minor
---

Add `Totp` — RFC 6238 time-based one-time passwords for MFA. A stateless,
dependency-free (Node crypto) helper to `generateSecret()`, build an
`otpauth://` provisioning `uri()` for authenticator-app enrolment, produce a
`code()`, and `verify()` a submitted token with configurable clock-skew
tolerance (`±window` steps) and constant-time comparison. Configurable period,
digits, and algorithm (SHA1/256/512); verified against the RFC 6238 test
vectors. Pairs with `PasswordHasher` for a second factor.
