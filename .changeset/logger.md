---
"turnover": minor
---

Add `Logger` — a structured, injectable logger.

- **`Logger`** logs structured records with `debug`/`info`/`warn`/`error(msg, fields?)`. It is quiet by default — only records at or above the minimum level (`info` unless `LOG_LEVEL` says otherwise) are emitted — and every record is automatically stamped with the current request's id (from `requestId()`), so logs correlate to requests without threading a `ctx` through.
- Records are JSON to stdout (warnings/errors to stderr) by default; bind a `LOG_SINK` provider to route them elsewhere (a file, a collector, a test spy). The level can be set with the `LOG_LEVEL` token or the `LOG_LEVEL` environment variable.
- Exposes `Logger`, `LOG_SINK`, `LOG_LEVEL`, `LogLevel`, `LogRecord`, and `LogSink`.
