---
'turnover': minor
---

Add `sse()` — build a streaming `text/event-stream` response from an async
source, returnable straight from a route handler. Accepts an async generator (or
any async iterable) of `SseEvent`s (`data`/`event`/`id`/`retry`), serializing
each to the wire format (string payloads verbatim, others JSON, multi-line
payloads split across `data:` lines) with an optional comment heartbeat. Ships
`SseChannel`, a push-driven async source for event-bus/pub-sub streams that
drains queued events before closing.
