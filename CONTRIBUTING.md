# Contributing to turnover

Thanks for helping build turnover — a decorator-first REST + DI framework for
Bun. It ships as a library with **zero runtime dependencies**, so contributions
are held to a high bar for API stability and portability.

## Quick start

```bash
bun install
bun test              # the suite (test/*.test.ts)
bun run lint          # Biome: format + lint (verification form)
bun run typecheck     # tsc --noEmit
bun run build         # tsc → dist/
bun run dev           # run the example app (example/) with hot reload
```

Before pushing, run the gate locally: `bun run lint && bun run typecheck && bun test`.

## The bar: five CI checks

`main` is protected and merges are squash-only. Every PR must pass, and a
**green PR — not a green local run — authorizes merge**:

| Check | Command |
| --- | --- |
| Changeset present | a `.changeset/*.md` declaring release impact |
| Lint & typecheck | `bun run lint` + `bun run typecheck` |
| Build | `bun run build` |
| Unit tests | `bun test` |
| Dependency audit | `bun audit --audit-level=high` |

There is no pre-commit hook — CI is the sole enforcement, so keep it green.

## One changeset per PR

Declare the release impact with `bun run changeset` (patch / minor / major +
a description), or `bun run changeset --empty` for a docs/CI/test-only change.
Pre-1.0 the version stays below `1.0.0` — reserve `major`/`1.0.0` for when the
framework is deemed ready for wide use. See [releasing](./contributing/releasing.md).

## Best practices

Read these before a substantial change — they're the house rules, with numbered
rules you can cite in review:

- **[Coding](./contributing/coding-best-practices.md)** — TypeScript discipline,
  standard TC39 decorators only, zero runtime deps + subpath exports, the
  web-standard (WinterTC) core, convention over configuration, DI, error
  handling.
- **[Testing](./contributing/testing-best-practices.md)** — `bun test`,
  in-memory `app.handle(Request)`, the global-registry isolation trap,
  determinism, no sleeps, generated-not-committed fixtures.
- **[Linting](./contributing/linting-best-practices.md)** — the Biome ruleset
  and why, formatting, reasoned escape hatches, and how to add a new check.
