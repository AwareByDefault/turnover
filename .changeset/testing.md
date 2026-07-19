---
'turnover': minor
---

Add a `turnover/testing` subpath with `testClient()` — an ergonomic in-memory
client that routes requests through an app's `handle` with no socket. JSON
bodies are serialized and content-typed automatically; strings, `FormData`, and
binary bodies pass through untouched; default and per-request headers merge; and
responses are re-readable so status, headers, and body can all be asserted.
Kept out of the main barrel so it never ships in a production bundle.
