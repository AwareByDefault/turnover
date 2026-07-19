# Testing best practices

The authoritative reference for how turnover is tested. For how code is written
see [coding-best-practices.md](./coding-best-practices.md); for lint/format see
[linting-best-practices.md](./linting-best-practices.md).

Tests run with **`bun test`** (`test/*.test.ts`). A change is complete only when
`bun test`, `bun run typecheck`, and `bun run lint` all pass — `tsc` covers test
files too, so **a type error in a test is a failure like any other**.

## 1. Tests are mandatory, and they prove behavior

- **1.1 — Every feature or fix ships with tests that assert observable
  behavior** — status codes, response bodies, span attributes, mounted routes —
  not that a symbol exists. "The greeting is DI-injected", "a bad body → 422",
  not "createApp returns an object".
- **1.2 — Cover the error paths and edges, not just the happy path:** missing
  route → 404, wrong method → 405, invalid input → 422, empty/duplicate inputs,
  a throwing handler → opaque 500. The edges are the contract.

## 2. Exercise the real request pipeline in memory

- **2.1 — Drive HTTP through `app.handle(new Request(...))`.** It runs the whole
  pipeline (routing, guards, DI, validation, coercion) with no socket, and
  `listen()` serves through the same method — so an in-memory call behaves
  exactly like a live one, and the test is runtime-agnostic.

  ```ts
  const app = await createApp({ controllers: [UsersController] });
  const res = await app.handle(new Request("http://t/users/1"));
  expect(res.status).toBe(200);
  ```

- **2.2 — When you need a real socket, `listen(0)`** for an OS-assigned port
  (parallel-safe) and `server.stop()` in a `finally`/`afterAll`.

## 3. ⚠️ The global-registry isolation trap

- **3.1 — `@controller` classes self-register into a *process-global* registry
  on import.** `createApp({ controllers: [...] })` mounts **only** the listed
  classes (isolated) — always prefer it in tests. But `createApp({ dir })`
  (auto-discovery) mounts the **entire** global registry, so in the shared
  `bun test` process it also picks up controllers other test files registered.
- **3.2 — Any test that exercises auto-discovery MUST run in its own process.**
  Spawn it (see `test/scan-stress/run.ts`, invoked by `test/scan-stress.test.ts`
  via `Bun.spawn`) so the scan sees only its own fixture. This bug is invisible
  when the file runs alone and only appears in the full suite / CI — which is
  exactly how it bit us once.

## 4. Determinism

- **4.1 — A test produces identical results on every run, machine, and order.**
  No `Date.now()`/`Math.random()`/wall clock/ambient timezone in code under
  test or setup; inject anything that must vary (a module-level counter for
  ids, a fixed value for a clock).
- **4.2 — `retries` are zero. A flake fails the run.** A flake is a missing wait
  or a determinism bug — fix the cause, never paper over it.

## 5. No sleeps — wait on the real signal

- **5.1 — Never `setTimeout`-sleep to await async work** (simultaneously too
  slow and too flaky). Make the thing awaitable: `await app.handle(...)`, read
  the server's `READY` line, await a published event, or retry a `fetch` against
  a booted server (`--retry-connrefused`). If you're reaching for a sleep,
  you're missing the real signal.

## 6. Isolation, cleanup & lifecycles

- **6.1 — Never share mutable state (a temp dir, a container, a DB) across
  tests;** give each its own and tear it down in `afterAll`/`finally` **even on
  failure**.
- **6.2 — Prefer dependency injection over module mocking.** The module registry
  is process-global; a mock poisons that module for every file loaded after it.
  turnover's DI makes real substitution easy — bind a provider (`{ provide,
  useValue }`) instead of mocking a module.
- **6.3 — Stop what you start.** A test that `listen()`s or runs `@scheduled`
  tasks must `await app.stop()` (clears intervals, runs `@preDestroy`), or the
  timers leak past the test. Any fire-and-forget async reachable from code under
  test needs a `.catch()`, or an in-flight rejection at teardown surfaces as a
  spurious, misattributed failure.

## 7. Generated & large fixtures are not committed

- **7.1 — Generate large/synthetic fixtures; don't commit them.** A small
  deterministic generator (`test/scan-stress/generate.ts`) writes a **gitignored**
  fixture, so the repo stays lean and the fixture is reproducible. Exclude the
  generated directory from git, `tsc` (`tsconfig` `exclude`), and Biome
  (`files.includes` ignore) — a stale artifact must never fail an unrelated run.

## 8. Smoke-test what can't be unit-tested; prove the big claims

- **8.1 — Tooling that isn't a unit (benchmarks, bundling) gets a smoke test
  that runs the real thing** via `Bun.spawn` and asserts it completes and
  behaves — see `test/benchmarks.test.ts` and `test/bundle-smoke.test.ts` (which
  actually `bun build`s a server, runs it, and cURLs it). These guard against
  silent rot.
- **8.2 — Prove cross-cutting behavior end-to-end and at scale.** The scan stress
  test discovers + wires a 300+-file tree (and scales to a million lines); the
  bundle smoke test proves both that a manual server survives bundling and that
  auto-discovery doesn't. Don't let one layer's green mask another's failure.

## 9. Test the public contract through the barrel

- **9.1 — Consumer-facing behavior is tested by importing from `../src`** (the
  public surface), not internal modules. `test/extensibility.test.ts` rebuilds
  an OTel-style class decorator using only public exports — proving the surface
  is actually sufficient to build plugins.

## 10. Keep the default suite fast

- **10.1 — `bun test` stays quick;** heavy or long runs are opt-in scripts
  (`bun run test:scan-stress` for the million-line scan, `bun run bench`). The
  in-suite smokes use small sizes so every push stays fast.

## 11. ⚠️ Request-reconstruction gotcha

- **11.1 — When you rebuild a `Request` (e.g. to rewrite a URL), it must carry
  the method, headers, and body.** `new Request(url, req)` copies them in Bun —
  but per the Fetch spec, seeding only from a bare `init` object *replaces* the
  Request's headers and drops the content-type/body, which breaks POST/PATCH
  while GET still looks fine. Assert a delegated/rewrapped POST round-trips its
  body (see `test/delegate.test.ts`).
