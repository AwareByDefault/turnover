---
"turnover": minor
---

Add `@configProperties` — typed, validated configuration binding.

- **`@configProperties(schema)`** binds a class's fields to environment variables by naming convention (`DATABASE_URL` → `databaseUrl`) and validates the whole object through a Standard Schema when the class is constructed, failing fast with a `ConfigValidationError` that lists the offending fields. The validated (and coerced) result is assigned onto the instance, which is an injectable singleton — `inject(Settings).port` is a real, checked `number` instead of a stringly-typed `value("PORT", …)` read.
- Reads from `Bun.env` by default; a `CONFIG_SOURCE` provider or `createApp({ config })` overrides it. An optional `prefix` binds only variables under a namespace (`APP_`). The schema must validate synchronously.
- Adds an optional `entries()` to `ConfigSource` (implemented by the built-in env and record sources) so the whole source can be enumerated. Exposes `configProperties`, `ConfigValidationError`, and `ConfigPropertiesOptions`.
