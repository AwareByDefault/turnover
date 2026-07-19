---
'turnover': minor
---

Add `PasswordHasher` — an injectable password hasher over Bun's native
Argon2/bcrypt. Sensible defaults (Argon2id), cost configurable via the
`PASSWORD_OPTIONS` DI token, a `verify()` that returns `false` for a malformed
hash instead of throwing, and `needsRehash()` to transparently upgrade a stored
hash on the user's next login. Completes the credential half of the login flow
alongside `session()`.
