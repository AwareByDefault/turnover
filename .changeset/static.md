---
'turnover': minor
---

Add `serveStatic()` — serve files from a directory before routing. A
`GET`/`HEAD` under the configured `prefix` maps to a file in `dir` (with the
`Content-Type` inferred from the extension), a directory request serves the
`index` file, a missing file falls through to the router (404), and a path that
escapes the root via `..` is refused with `403`. Optional `Cache-Control`.
