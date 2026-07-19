# Coding best practices

The authoritative reference for how code is written in turnover. For tests see
[testing-best-practices.md](./testing-best-practices.md); for lint/format see
[linting-best-practices.md](./linting-best-practices.md); for cutting a release
see [releasing.md](./releasing.md).

Rules are numbered `N.M` so they're citable in review ("violates §3.2"). Each
rule states the mandate, then *why it exists*. Turnover is a **decorator-first
REST + DI framework for Bun**: a library others depend on, so the bar is API
stability, portability, and a footprint of zero runtime dependencies.

## 1. TypeScript discipline

- **1.1 — `strict` stays on, everywhere.** Never weaken it per-file. The type
  system is a load-bearing part of the public contract.
- **1.2 — Type-only imports/exports use `import type` / `export type`**
  (`useImportType`). Don't mix a value and a type-only name in one `import {}`.
  It keeps the emitted module graph honest and the barrel tree-shakeable.
- **1.3 — No non-null assertions (`!`) in `src/`** (`noNonNullAssertion`).
  A `!` is a lie to the type checker — narrow with a guard, `throw` with a
  message, or restructure. (Tests may use `!`; they build their own data.)
- **1.4 — Treat every `record[key]` / `array[i]` as possibly `undefined`** and
  narrow before use. Fix with a real guard or an inert nullish default
  (`match[1] ?? ''` for an always-present regex group), never a cast. Enforced
  by `noUncheckedIndexedAccess`.
- **1.5 — Prefer `as const` arrays + derived unions** over hand-written string
  unions — one source of truth for the values and their type. Narrow
  discriminated unions on their tag, never by casting; on a kind change,
  reconstruct the full variant rather than spreading unknowns.
- **1.6 — Bump `target`/`lib`, don't cast around a missing runtime type.** If
  you need a newer API, raise the compiler target; a cast hides a real gap.

## 2. Standard TC39 decorators only

- **2.1 — Use standard decorators; never `experimentalDecorators`,
  `emitDecoratorMetadata`, or `reflect-metadata`.** turnover works under the
  default `tsconfig` with no decorator flags. This is the framework's defining
  constraint — do not regress it for convenience.
- **2.2 — No parameter decorators and no design-type reflection** (standard
  decorators have neither). The consequences are deliberate design, not
  workarounds: dependencies are pulled with a **field-initializer `inject()`**,
  handlers take a `ctx` object, and tokens/schemas are explicit.
- **2.3 — Coordinate between decorators through the shared metadata bag.** Read
  and write `context.metadata` (via `decoratorMeta(context)` / `classMeta(cls)`
  from `metadata.ts`), keyed by a module-local `Symbol`. Member decorators run
  before the class decorator on the same class — rely on that order (that's how
  class-level `@traced()` reads `@noTrace` markers).

## 3. Zero runtime dependencies

- **3.1 — The published package MUST NOT add a hard runtime dependency.** Prefer
  Bun built-ins (`Bun.serve`, `Bun.Glob`, `Bun.file`) and `node:*` over any
  third party. Adding a `dependency` is a deliberate, discussed decision — not a
  convenience. Validation speaks [Standard Schema](https://standardschema.dev)
  so no validator is pulled in.
- **3.2 — Optional/heavy integrations live behind an optional peer dependency
  *and* a subpath export — never the barrel.** The core must import and run with
  none installed. OpenTelemetry is `turnover/otel` (optional peer
  `@opentelemetry/api`); build-time tooling is `turnover/bundler` (imports only
  `bun`/`node` types). The build gate asserts `dist/index.js` never references
  them, and `noRestrictedImports` (linting §2) bans importing an optional peer
  outside its subpath module.

  ```ts
  // Good — otel is opt-in; consumers without it still `import ... from "turnover"`
  import { otel } from "turnover/otel";
  // Bad — pulling an optional dep into the barrel breaks every consumer
  export { otel } from "./otel"; // in src/index.ts
  ```

## 4. Web-standard core (WinterTC)

- **4.1 — The request pipeline is a WinterTC `(Request) => Promise<Response>`
  handler** built on the [Minimum Common API](https://min-common-api.proposal.wintertc.org/)
  (`Request`, `Response`, `Headers`, `URL`, streams). Keep runtime-specific APIs
  out of the hot path so an app deploys on any compliant runtime.
- **4.2 — Confine runtime coupling to adapters.** `Bun.serve` belongs only in
  `app.listen()`; filesystem APIs (`Bun.Glob`/`Bun.file`) belong only in
  auto-discovery, which is inherently a filesystem feature. `app.fetch` is the
  portable entry; `app.handle` is the single request path everything routes
  through.

## 5. Convention over configuration

- **5.1 — Auto-configure with smart defaults; make everything overridable.**
  New features default to zero config (auto-discovery, the aspect processor
  auto-registers, JSON is the default codec) and layer configuration on top via
  `createApp` options, plugins, providers, and decorators.
- **5.2 — Prefer a plugin/decorator seam over a core special-case.** Cross-
  cutting behavior is expressed through the existing seams (guards, `@intercept`,
  `wrap`, method AOP, post-processors) so consumers can build the same thing.
  If a feature needs a new core primitive, make it general (e.g. `wrap`,
  `addAround`), not one-off.

## 6. The public API is the contract

- **6.1 — Everything consumers use is exported from the single barrel
  `src/index.ts`;** optional/build-time surfaces get their own subpath. Internal
  modules import each other freely but are not re-exported unless intended as
  public API. Keep the barrel minimal and intentional.
- **6.2 — Named exports only** (`noDefaultExport`). One naming style, no default
  vs named ambiguity, cleaner re-exports.
- **6.3 — Every exported symbol carries JSDoc** with a one-line purpose and,
  for anything non-obvious, a usage example. ⚠️ Never write a literal `*/`
  inside a block comment (e.g. an unescaped glob) — it closes the comment early
  and cascades dozens of parse errors; wrap globs in backticks or reword them.

## 7. Module side effects

- **7.1 — Importing a module does no work** — no I/O, no network, no listening.
  The one sanctioned exception is decorator registration: importing a
  `@controller`/`@injectable`/`@onEvent` class runs its decorator, which
  self-registers it into a **process-global** registry. That registry is how
  auto-discovery finds controllers — and it's a sharp edge in tests (see
  testing §3). Be deliberate about it; don't add other import-time side effects.

## 8. Error handling & failure isolation

- **8.1 — Throw `HttpError` (or a named subclass), never a hand-built error
  `Response`.** Error-to-response shaping is centralized (`toErrorResponse` +
  the route → controller → global → default handler chain). One place owns the
  envelope.
- **8.2 — Anything that isn't an `HttpError` becomes an opaque `500`** whose
  message is never leaked to the client and is logged. A response-validation
  failure is a server bug, not a client error.
- **8.3 — One failing route or guard MUST NOT take down the server.** The
  pipeline contains a throw and renders it; per-request telemetry
  (`onAfterResponse`/`onTrace`) and event listeners are fire-and-forget and log
  their own failures rather than propagating.

## 9. Dependency injection

- **9.1 — Inject in a field initializer: `private x = inject(Token)`.** No
  constructor wiring. Concrete `@injectable` classes auto-construct; bind
  interfaces/values/config with `providers`/`InjectionToken`.
- **9.2 — Singletons are the default;** reach for `transient`/`request` scope
  deliberately. A request-scoped bean injected into a singleton is a proxy that
  resolves the current request's instance.
- **9.3 — Self-invocation bypasses method advice:**
  `this.other()` inside a method calls the raw object, so `@traced`/`@cacheable`/
  `@transactional` don't apply to internal calls. Document this where a consumer
  might trip on it.

## 10. Logging

- **10.1 — Quiet on the happy path, loud only on the actionable.** The framework
  emits no per-request noise. Diagnostics and unexpected errors go to
  `console.error` (stderr) with the `[turnover]` prefix; never log per-request on
  the success path.

## 11. Module layout

- **11.1 — One concern per file in `src/`** (`http`, `di`, `aop`, `schema`,
  `config`, …), each re-exported through the barrel. Keep pure logic separable
  and testable; keep the Bun/`node:` touchpoints thin and localized.
