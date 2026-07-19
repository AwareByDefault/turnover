---
"turnover": minor
---

Expose the decorator-metadata helpers so consumers can build their own AOP decorators and plugins with the same primitives the built-ins use.

- **`decoratorMeta(context)`** — the shared metadata bag for the class being decorated (from a decorator's `context`).
- **`classMeta(target)`** — the metadata bag attached to a class at runtime (`Class[Symbol.metadata]`), for inspecting a class inside a container post-processor.
- **`MetaBag`** — the bag's type.

Together with the already-public `addAround`, `around`/`before`/`after`, `aspectProcessor`, `Container.addPostProcessor`, and the `Plugin`/`wrap` surface, these let a consumer rebuild something like the `turnover/otel` plugin (class-level `@traced` + `@noTrace` opt-out) entirely from the public API — no internal imports.
