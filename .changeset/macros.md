---
"turnover": minor
---

Add macros — named, parameterized, DI-resolvable cross-cutting bundles.

- **`defineMacro(name, factory)`** registers a macro whose factory returns a bundle of hooks (`use` / `derive` / `intercept` / `catchError`). **`@macro(name, ...args)`** (controller or route) applies it, expanding into the same pipeline as the individual decorators.
- The factory runs **in an injection context at mount time**, so it can `inject()` services and close over them — the DI + cross-cutting "fusion". Class- and method-level macros both apply, and multiple compose.
- Unknown macro names throw at mount. Adds `Container.runInContext(fn)` (run a function with the container active so `inject()` works). Exposes `defineMacro`, `macro`, `MacroHooks`, and `MacroFactory`.
