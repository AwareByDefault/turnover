---
'turnover': minor
---

Add a `turnover/codegen` subpath with `generateClient()` — generate a
self-contained, dependency-free typed TypeScript client from an OpenAPI document
(such as the one `app.openapi()` produces). Each operation becomes a method
typed from its path/query parameters, request body, and 2xx response schema; the
generated client builds the URL, query string, and JSON body and calls an
injectable `fetch`. Run it at build time (a four-line CLI wrapper is shown in the
docs) and commit or bundle the output.
