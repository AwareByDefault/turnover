---
'turnover': minor
---

Add WebSocket support. Register a `WebSocketRoute` via `createApp({ websocket })`
or `app.websocket(route)` and `listen()` serves it alongside the HTTP routes:
matching upgrade requests are accepted (with an `upgrade(req)` hook to
authenticate and attach typed `ws.data`, or reject with `401`), and `open` /
`message` / `close` / `drain` lifecycle callbacks receive Bun's native
`ServerWebSocket`. Everything else keeps routing through `handle()` unchanged.
