# Filesystem-scan stress test

Stress-tests auto-discovery (`createApp({ dir })`) against a large, complex tree,
and compares its server-start time against **manual registration**
(`createApp({ controllers })`).

Rather than commit hundreds/thousands of boilerplate files, a deterministic
generator (`generate.ts`) writes a **gitignored** fixture, regenerated on demand
— so the repo stays lean and the fixture is reproducible.

Each feature is 9 files (~192 lines): model, events, util (non-controller
"noise"), repository, service, listener, guard, schema, controller. Plus a
generated `controllers.ts` barrel that lists every controller — the input for
the manual-registration arm. The tree exercises auth + role guards, validation,
method AOP (`@before`/`@after`/`@around`), events + `@onEvent` listeners, and a
cross-feature DI chain (capped at a depth of 40 so it scales).

## Running

```bash
# Fast smoke — runs automatically as part of `bun test` (40 features, ~7.8k lines)
bun run test/scan-stress/run.ts

# Scale to a target line count or feature count (fixture is gitignored):
bun run test/scan-stress/run.ts --lines 1000000 --cleanup
bun run test/scan-stress/run.ts --features 800

# The million-line run, wired as a script:
bun run test:scan-stress
```

Every run reports the same thing at whatever scale: how long the server takes to
start via the **filesystem scan** vs. **manual registration**.

## How the comparison stays fair

Both paths import the exact same modules; the only difference is that
auto-discovery additionally reads every file to look for `@controller`. Both are
timed **cold** (from nothing imported), which needs two fresh processes — the
scan is timed in the main process, and `run.ts` re-invokes itself with
`--time-manual` to time a cold `createApp({ controllers })` (importing the
`controllers.ts` barrel) in a clean process. The difference is the scan's cost.

Isolation also matters for correctness: `createApp({ dir })` mounts the *global*
`@controller` registry, so a clean process keeps the scan scoped to this
fixture's controllers. The in-suite test (`../scan-stress.test.ts`) spawns the
small smoke; the million-line run is opt-in (~24s, ~775 MB — too heavy for every
`bun test` / CI run).

## Measured (Apple M1, Bun 1.3.14)

| Features | Files  | Lines     | Endpoints | Auto (scan) | Manual   | Scan cost        |
| -------- | ------ | --------- | --------- | ----------- | -------- | ---------------- |
| 40       | 366    | 7,828     | 240       | ~40 ms      | ~18 ms   | ~22 ms (+125%)   |
| 5,156    | 46,410 | 1,000,076 | 30,936    | ~14.9 s     | ~2.9 s   | ~12 s (+418%)    |

At a million lines, generating the fixture takes ~2.6 s and peak RSS is ~775 MB.
The scan's overhead is dominated by reading all ~46k files sequentially to find
`@controller` — the modules themselves are imported by both paths — so manual
registration (which skips the walk) starts the server ~5× faster at that scale.
