# Linting best practices

The authoritative reference for linting, formatting, and static enforcement in
turnover. For how code is written see
[coding-best-practices.md](./coding-best-practices.md); for tests see
[testing-best-practices.md](./testing-best-practices.md).

Lint and format are one tool — **[Biome](https://biomejs.dev)** — configured in
[`biome.json`](../biome.json). `bun run lint` (`biome check .`) is the
verification form (fails on unformatted/unlinted code); `bun run lint:fix`
(`biome check --write .`) formats and applies safe fixes.

## 1. ⚠️ How it's gated: CI only

- **1.1 — There is no pre-commit hook. CI is the sole enforcement.** The five
  branch-protection checks (`Changeset present`, `Lint & typecheck`, `Build`,
  `Unit tests`, `Dependency audit`) gate every PR, and a **green PR — not a
  green local run — authorizes merge**. Because there's no local backstop, the
  CI gate MUST stay comprehensive; don't move enforcement out of it.
- **1.2 — Run the gate yourself before pushing:** `bun run lint && bun run
  typecheck && bun test`. Types are part of linting — `tsc --noEmit` runs in the
  same `Lint & typecheck` job, so a type error is a lint failure.

## 2. The ruleset and why

Biome's `recommended` preset plus these choices. Escape any rule with
`// biome-ignore lint/<rule>: <reason>` — **the reason is required.**

| Rule | Setting | Why |
| --- | --- | --- |
| `noExplicitAny` | **off** | A generics-heavy framework legitimately uses `any` for opaque plumbing (macros, AOP, typed-client inference). Don't add `biome-ignore` for `any` — the rule is off on purpose. |
| `noNonNullAssertion` | **error** (off in `*.test.ts`) | `!` lies to the checker; narrow instead. Tests build their own data, where `arr[0]!` documents intent without a dead guard. |
| `useImportType` | error | Honest, tree-shakeable module graph (see coding §1.2). |
| `noRestrictedImports` | error (scoped) | Mechanizes two non-negotiables: `reflect-metadata` is banned everywhere (standard decorators only — coding §2), and `@opentelemetry/*` is banned outside `src/otel.ts` (optional peers live behind subpaths — coding §3.2). Overrides re-allow the stable API in `src/otel.ts` and the full SDK in tests. |
| `noDefaultExport` | error | Named exports only — one style, cleaner re-exports. |
| `noReExportAll` | error (off for `index.ts`) | Barrels re-export explicitly; the public barrel is the one place `export *`-style breadth is allowed. |
| `useNamingConvention` | error | camelCase/PascalCase; object-literal keys exempt (external shapes). |
| `noFloatingPromises` | error | Every promise is awaited or explicitly `void`ed — no silent unhandled rejections. |
| `noUnusedImports` / `noUnusedVariables` | error | Dead code doesn't ship. |
| `noParameterAssign`, `noNestedTernary`, `useConsistentBuiltinInstantiation` | error | Readability + correctness defaults. |

## 3. Formatting — don't fight it

- **3.1 — The formatter is authoritative:** 2-space indent, 80-column width,
  single quotes, **no semicolons**, trailing commas everywhere, always-
  parenthesized arrows, organized imports. Run `bun run lint:fix` and move on;
  never hand-format against it.

## 4. Suppress narrowly, with a reason, and clean up

- **4.1 — A `biome-ignore` states *why*** and covers the single line it
  precedes (e.g. `noConfusingVoidType` on the `Deriver` type, because a deriver
  legitimately returns `void`; `noEmptyInterface` on augmentation targets).
- **4.2 — Remove stale suppressions.** Biome flags an ignore that no longer
  suppresses anything — delete it (as we did when `noExplicitAny` went off).

## 5. ⚠️ The `*/`-in-comment trap

- **5.1 — A literal `*/` inside a block/JSDoc comment closes it early** and
  cascades dozens of parse errors far from the real spot. It's easy to hit with
  an unescaped glob. Wrap globs in backticks or reword them in prose.

## 6. Prefer precise types over casts

- **6.1 — When inference produces a too-wide type, add per-signature
  overloads** rather than casting the result. `Config.get(key, fallback)` and
  the typed client use explicit overloads so the return type tracks the input —
  a captured-literal fallback would erase it. Reach for a cast last.

## 7. Excludes

- **7.1 — Generated and non-source directories are excluded from both Biome and
  `tsc`:** `dist/`, `test/.scan-fixture/`, `.claude/`, `.github/`, `.vscode/`.
  A generated fixture is a build artifact, not source — it must never fail lint
  or typecheck.

## 8. Adding a new check — cheapest home first

When you want to enforce a new rule mechanically (and it should always be
mechanical, never "remember the rule"), pick the cheapest home that fits:

1. **A Biome built-in rule** — one config line, zero maintenance. Always prefer
   tightening `biome.json` over anything custom. The dependency boundary
   (`reflect-metadata`, optional OTel peers) is enforced this way with
   `noRestrictedImports` — not a scanner.
2. **A `tsc` flag** — a rule fundamentally about types belongs in the compiler,
   not a scanner (`noUncheckedIndexedAccess` enforces coding §1.4).
3. **A GritQL plugin** (`*.grit`) for an AST call/member pattern Biome can't
   express out of the box, run inside `biome check` with a custom message.
4. **A custom script** in `tools/lint/` — only for cross-cutting rules over
   Markdown or string patterns that none of the above can see.

### 8.1 The `tools/lint/` runner

`bun run lint` runs `biome check` **and then** `bun tools/lint/index.ts`, which
executes every check in [`checks-list.ts`](../tools/lint/checks-list.ts) in
parallel and fails if any exits non-zero. One check lives there today,
enforcing something Biome and `tsc` can't:

| Check | Enforces | Escape |
| --- | --- | --- |
| `best-practices-numbering` | `## N.` / `- **N.M` numbering stays gapless and every `§N.M` citation resolves. | `allow: numbering` |

Each check binds to the rule it mechanizes in `REGISTRY` — a
`Record<CheckName, …>`, so an unregistered check is a compile error.

### 8.2 Writing one

1. Add `checks/<name>.ts` — export the pure scan function(s), then guard the CLI
   with `if (import.meta.main)`. Scan with `Bun.Glob`, print `path:line: message`
   to stderr, and exit non-zero on any violation.
2. Honor an `allow: <tag>` escape (checked on the line or the line above) where a
   legitimate exception is plausible.
3. Add `'<name>'` to `CHECKS` and bind it in `REGISTRY` (the type forces this).
4. **Unit-test it** next to the source (`<name>.test.ts`) — checks are infra
   that can silently rot. Test the pure functions, not the process exit.
5. A check that must spell out the pattern it bans exempts its own
   `tools/lint/` directory.
