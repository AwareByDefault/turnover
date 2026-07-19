---
"turnover": minor
---

Add an in-process event bus for decoupling.

- **`Events`** (injectable) — `publish(event)` dispatches an event object to every subscriber of its class and awaits them all; `on(type, listener)` subscribes and returns an unsubscribe function. A failing listener is logged, not propagated.
- **`@onEvent(EventType)`** subscribes a service method; it registers when the service is constructed. List listener services in **`createApp({ listeners })`** to construct them eagerly (when nothing else injects them).
- Exposes `Events`, `onEvent`, `EventType`, and `EventListener`.
