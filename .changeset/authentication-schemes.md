---
"turnover": minor
---

Add the authentication stage — `authentication()`, `bearer()`, `apiKey()`.

- **`authentication(schemes)`** is a plugin that runs registered schemes on every request in order; the first to resolve a principal attaches it to the request, so `inject(Auth).user`, `@authenticated`, and `@requireRole` see it, and an unrecognised request is simply anonymous. This is authentication "baked in" — you provide the credential-parsing strategies, and authorization lives on the controller.
- **`bearer({ verify })`** reads `Authorization: Bearer <token>` (JWTs or opaque tokens); **`apiKey({ verify, header? })`** reads an API key from a header (default `x-api-key`). Both call your `verify` to turn the credential into a principal.
- An `AuthScheme` is `{ name, authenticate(ctx) → Principal | null }` — implement one for any credential type. Exposes `authentication`, `bearer`, `apiKey`, `AuthScheme`, `BearerOptions`, `ApiKeyOptions`.
