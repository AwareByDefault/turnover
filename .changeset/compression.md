---
"turnover": minor
---

Add `compression()` — gzip response compression.

- **`compression()`** is a plugin that gzip-compresses text-like responses (JSON, HTML, XML, `text/*`) when the client sends `Accept-Encoding: gzip` and the body is over a threshold (default 1 KB). It sets `Content-Encoding: gzip` and `Vary: Accept-Encoding`, and skips already-encoded, small, or non-text responses.
- The `threshold` and the set of compressible content-`types` are configurable. Exposes `compression` and `CompressionOptions`.
