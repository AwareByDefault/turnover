---
"turnover": minor
---

Add DI provider strategies — bind tokens to values, classes, factories, and aliases.

- **`InjectionToken<T>`** for non-class dependencies (interfaces, config values, multi-impl services).
- **`Container.register(token, provider)`** with `useValue` / `useClass` / `useFactory` (receives the container) / `useExisting` (alias). `useClass`/`useFactory` take an optional `scope`.
- **`createApp({ providers: [{ provide, useValue | useClass | useFactory | useExisting }] })`** registers providers before controllers mount. Register imperatively via `app.container.register(...)`.
- **Overriding**: the last registration for a token wins for `resolve()`/`inject()` (handy for test mocks). **Multi-injection**: `Container.resolveAll(token)` / `injectAll(token)` return every binding.
- Concrete `@injectable` classes still auto-construct without registration (unchanged). Exposes `InjectionToken`, `Token`, `Provider`, `ProviderDef`, and `injectAll`.
