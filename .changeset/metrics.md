---
'turnover': minor
---

Add `metrics()` — Prometheus metrics with automatic HTTP instrumentation. Ships
a dependency-free `MetricsRegistry` (`Counter`/`Gauge`/`Histogram`) that renders
the text exposition format, and a plugin recording `http_requests_total`,
`http_request_duration_seconds`, and `http_requests_in_flight` — labelled by
method, route pattern (low cardinality), and status — served at `/metrics`
before routing so scrapes aren't self-counted. Share a registry with the plugin
and bind it as a provider to record custom application metrics. Completes the
observability triad alongside logging and tracing.
