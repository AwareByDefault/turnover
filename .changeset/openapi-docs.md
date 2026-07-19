---
"turnover": minor
---

Add `app.docs()` — serve the OpenAPI spec and an interactive docs page.

- **`app.docs(options?)`** mounts `GET /openapi.json` (the document from `app.openapi()`) and, unless disabled, `GET /docs` (an interactive API reference UI), turning the OpenAPI generation the framework already does into live, browsable docs. Chain it after `createApp`: `const app = (await createApp()).docs()`.
- Paths are configurable (`jsonPath`, `uiPath`); set `uiPath: false` to serve only the JSON. `openapi` options (info, servers, `toJsonSchema`) pass straight through. Adds the `DocsOptions` type.
