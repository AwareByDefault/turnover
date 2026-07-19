---
"turnover": minor
---

Add `turnover/bundler` — make auto-discovery survive bundling.

Auto-discovery uses a runtime filesystem scan, which a bundler tree-shakes away, so a naively bundled `createApp()` app boots with zero routes. The new build-time helpers fix that:

- **`turnoverPlugin()`** — a `Bun.build` plugin that runs the same scan at build time and injects the discovered `@controller` files into the entrypoint (marking them side-effectful so they aren't tree-shaken). Your entry keeps calling `createApp()` with no arguments — no source changes:

  ```ts
  import { turnoverPlugin } from "turnover/bundler";
  await Bun.build({ entrypoints: ["./src/server.ts"], outdir: "dist", target: "bun", plugins: [turnoverPlugin()] });
  ```

- **`scanControllerFiles(dir)`** — the underlying scan (absolute paths of every `@controller` file), for generating your own manifest if you prefer explicit registration.

The core stays dependency-free (this is a separate subpath, importing only `bun`/`node` types). `test/bundle-smoke.test.ts` proves it end-to-end by building and cURLing a bundled server.
