---
"turnover": minor
---

Add a `"request"` DI scope.

- **`@injectable({ scope: "request" })`** gives one instance per request, shared across every injection within that request and rebuilt for the next. It's injected as a proxy that resolves the current request's instance, so it works even when injected into a singleton. Backed by the `AsyncLocalStorage` request state.
- App-level lifecycle tracking (awaiting async `@postConstruct` at bootstrap, running `@preDestroy` on shutdown) now applies **only to singletons** — transient/request beans are short-lived, so tracking them would leak. `@postConstruct` still runs on each transient/request instance.
