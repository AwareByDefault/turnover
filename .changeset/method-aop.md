---
"turnover": minor
---

Add general method-level AOP — `@before` / `@after` / `@around` advice on any injectable method.

- Advise *any* container-managed service method (not just HTTP handlers) with cross-cutting logic — logging, caching, retry, timing, transactions. `@around` receives a `ProceedingJoinPoint` and calls `proceed()` (optionally with modified args); it can transform the result, short-circuit, or catch errors. `@before` runs first; `@after` runs last (awaiting async methods).
- Multiple `@around` advice nest — the top-most decorator is outermost.
- Implemented via a `Proxy` post-processor (`aspectProcessor`) that `createApp` auto-registers; advice applies to calls through the injected instance, and **self-invocation bypasses advice** (Spring's proxy semantics). `#private` fields work through the proxy.
- Exposes `before`, `after`, `around`, `aspectProcessor`, and the `JoinPoint` / `ProceedingJoinPoint` / advice types.
