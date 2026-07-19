# AGENTS.md

Bare-bones instructions for AI agents (and humans) working in this repo. This
file is intentionally short — the detail lives in the linked guides. Read the
relevant one before a substantial change; don't guess.

**turnover** is a decorator-first REST + DI framework for Bun, shipped as a
library with **zero runtime dependencies**.

## Start here

- **How the framework works** → [README.md](README.md) — the public API, every
  feature (routing, DI, AOP, validation, lifecycle, OpenAPI, OTel), the request
  pipeline, and design notes.
- **How to contribute** → [CONTRIBUTING.md](CONTRIBUTING.md) — setup, the CI
  gates, one-changeset-per-PR.
- **House rules** (numbered `N.M`, cite them in review):
  - [Coding](contributing/coding-best-practices.md)
  - [Testing](contributing/testing-best-practices.md)
  - [Linting](contributing/linting-best-practices.md)
  - [Releasing](contributing/releasing.md)

## Non-negotiables

- **Standard TC39 decorators only** — never `experimentalDecorators`,
  `emitDecoratorMetadata`, `reflect-metadata`, or parameter decorators.
- **Zero runtime dependencies.** Optional integrations go behind an optional
  peer dependency **and** a subpath (e.g. `turnover/otel`, `turnover/bundler`),
  never the barrel.
- **Named exports only**, Biome formatting (single quotes, no semicolons) —
  run `bun run lint:fix`.
- **One changeset per PR** (`bun run changeset`, or `--empty` for docs/tests).
  Stay below `1.0.0` pre-release.
- **turnover is consumer-agnostic** — never couple it to, or name, a specific
  downstream application in code, docs, examples, or commits; express needs
  generically.
- **Run the gate before you push:**

  ```bash
  bun run lint && bun run typecheck && bun test && bun run build
  ```

  CI enforces all five checks (`Changeset present`, `Lint & typecheck`, `Build`,
  `Unit tests`, `Dependency audit`); there's no pre-commit hook, so a **green PR
  authorizes merge**. `main` is protected and squash-only.

## Layout

- `src/` — the framework, one concern per file; `src/index.ts` is the public
  barrel (subpaths: `turnover/auth`, `turnover/request`, `turnover/otel`,
  `turnover/bundler`).
- `test/` — the `bun test` suite. `example/` — a runnable demo (not shipped).
- `bench/` — `bun run bench`. `contributing/` — the guides linked above.
