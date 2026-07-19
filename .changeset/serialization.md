---
"turnover": minor
---

Add pluggable body parsers and response serializers.

- **`BodyParser`** — parse a request body by content type (exact, subtype wildcard, or catch-all). `ctx.body()` picks the first matching parser, falling back to the built-in JSON/text default.
- **`ResponseSerializer`** — turn a non-`Response` return value into a `Response`, or return `undefined` to defer. Serializers get first crack before the JSON default, can content-negotiate via `ctx` (the `Accept` header), wrap values (envelopes), or stream (`ReadableStream`).
- Register via `createApp({ parsers, serializers })`, `app.addParser()` / `app.addSerializer()`, or a `Plugin` (`parsers` / `serializers`). Exposes `BodyParser` and `ResponseSerializer`.
