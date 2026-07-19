---
"turnover": minor
---

Add `bodyLimit()` — reject oversized request bodies.

- **`bodyLimit(maxBytes)`** is a plugin that rejects a request whose `Content-Length` exceeds the limit with `413 Payload Too Large`, before the body is read — a cheap first-line guard against oversized uploads. (Chunked requests that omit `Content-Length` pass this check; enforce those in a streaming parser.)
