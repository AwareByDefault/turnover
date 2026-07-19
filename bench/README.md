# Benchmarks

Performance benchmarks for the framework. This folder is **not** part of the
published package (it lives outside `src/`).

```bash
bun run bench                       # run the whole suite
bun run bench/throughput.bench.ts   # run one benchmark
bun run bench/memory.bench.ts --quick   # fewer iterations (used by the smoke test)
```

Each benchmark runs in its own process (a clean heap, and an isolated
`@controller` discovery registry). The numbers are **machine- and
runtime-dependent** — read them as relative costs, not absolutes.

## What's measured

| Benchmark | Measures |
| --------- | -------- |
| `startup.bench.ts` | Time to build an app, **auto-discovery vs. manual** registration (12 controllers). The difference is the filesystem-scan overhead. |
| `throughput.bench.ts` | Requests/sec through `app.handle()` — the in-memory path (routing, guards, DI, validation, coercion) with no socket — for static, param, query, body-parse, guard, validation, injected-singleton, request-scoped, and 404 routes. |
| `injection.bench.ts` | Construction cost of a class with 0/1/4/8 injected dependencies (fresh container each call), and the per-dependency cost. |
| `memory.bench.ts` | Retained heap (after a forced GC) for the framework baseline, per controller, RSS after boot, and retained heap **per request** (a leak check). |
| `bundle.bench.ts` | Bundle footprint of the public entry via `Bun.build`: unminified, minified, and gzipped, plus the published `dist/` size. |

## How it works

- **Timing** uses `Bun.nanoseconds()`, batched into rounds (mean + p50/p99) after
  a warmup — far steadier than timing individual sub-microsecond calls.
- **Memory** uses `Bun.gc(true)` (a forced, synchronous GC) then
  `process.memoryUsage()`, so figures reflect *retained* memory, not transient
  allocation. They are noisy — treat them as orders of magnitude.
- **Throughput** goes through `app.handle(Request)` rather than a live socket, so
  it isolates the framework's per-request overhead from `Bun.serve` and the
  network. Real end-to-end throughput is additionally bounded by `Bun.serve`.
- **Validation** uses a tiny inline [Standard Schema](https://standardschema.dev)
  so the suite takes no validator dependency.

The suite is covered by `test/benchmarks.test.ts`, which runs each benchmark in
`--quick` mode and asserts it completes — so the benchmarks can't silently break.
