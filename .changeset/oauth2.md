---
'turnover': minor
---

Add `OAuth2Client` — a minimal OAuth 2.0 / OIDC authorization-code client with
PKCE for social and enterprise sign-in. `createAuthorizationUrl()` builds a login
URL with a fresh `state` and S256 code challenge; `exchangeCode()` swaps the code
(and PKCE verifier) for tokens; `refreshToken()` renews them; `fetchUserInfo()`
reads the OIDC profile. Endpoints are configured generically (works with any
conformant provider), client authentication supports `body` or HTTP `basic`, and
network calls go through an injectable `fetch`. Dependency-free.
