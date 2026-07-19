---
"turnover": patch
---

Harden the toolchain — enforce the framework's own boundaries mechanically instead of by review.

- **`noRestrictedImports`** now bans `reflect-metadata` everywhere (standard TC39 decorators only) and `@opentelemetry/*` outside `src/otel.ts` (optional peers stay behind their subpath). The zero-dependency and standard-decorator guarantees are checked in CI, not just documented.
- **Stricter type-checking** — `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `noFallthroughCasesInSwitch`, and `noImplicitOverride` are on. Every indexed access in `src/` is now guarded (no non-null assertions), making the "possibly undefined" rule mechanical.
- **A `tools/lint/` check runner** — `bun run lint` now also runs a check Biome and `tsc` can't express: numbered-doc integrity (`§N.M` citations stay resolvable). It is unit-tested and bound to the rule it enforces.

No public API change.
