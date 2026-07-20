---
title: Auto-discovery & bundling
description: How createApp() finds your controllers by default, how to register them explicitly, and how to keep discovery working through a bundle.
sidebar:
  order: 6
---

Turnover mounts controllers one of two ways: it either **discovers** them by scanning the
filesystem (the default), or mounts **exactly** the ones you hand it. Discovery is the most
convenient, but it relies on a runtime scan that a bundler will optimize away — so this page
covers both, and how to keep discovery working when you bundle.

## Auto-discovery is the default

Call `createApp()` with no `controllers` and no `modules`, and it scans your entry file's
directory tree (`**/*.ts` via `Bun.Glob`), imports every file whose source contains
`@controller(`, and lets each one self-register as its module loads. There is no barrel of
imports to maintain.

```ts title="server.ts"
import { createApp } from "turnover";

const app = await createApp(); // scans the entry file's directory tree
app.listen(3000);
```

The scan root defaults to the directory of your entry script. To scan elsewhere, pass `dir`:

```ts title="server.ts"
const app = await createApp({ dir: "./src" }); // point the scan at ./src
```

## Explicit registration

Pass `controllers` and/or `modules` to mount **exactly those** and skip the filesystem scan
entirely:

```ts title="server.ts"
import { createApp } from "turnover";
import { UsersController } from "./users.controller";
import { AdminModule } from "./admin.module";

const app = await createApp({
  controllers: [UsersController],
  modules: [AdminModule],
});
```

Explicitly listed controllers mount **isolated** from the global discovery registry, so a
test mounts only what it names — nothing leaks in from a stray `@controller` elsewhere in
the project. Reach for explicit registration in tests, when you want order-controlled
wiring, or any time a glob scan won't work — which brings us to bundling.

:::note
Providing **either** `controllers` or `modules` skips the scan. If you want a discovered set
*plus* a few explicit additions, prefer the build-time plugin below over mixing the two.
:::

## Bundling: the zero-routes gotcha

:::caution
Auto-discovery relies on a **runtime filesystem scan**. Nothing in your code statically
imports the controllers, so a bundler tree-shakes them away — and a naively bundled
`createApp()` app boots with **zero routes**. Every request `404`s, with no error at build
time to warn you.
:::

There are two ways to fix it.

### Option A — keep discovery with `turnoverPlugin()`

`turnover/bundler` ships a `Bun.build` plugin that runs the *same* scan at **build** time.
It finds your `@controller` files and injects a static side-effect import of each into the
entrypoint, so the bundler includes them and they self-register on load — exactly the set
the runtime scan would have found. Your entry keeps calling `createApp()` with no arguments;
nothing in the app changes.

```ts title="build.ts"
import { turnoverPlugin } from "turnover/bundler";

await Bun.build({
  entrypoints: ["./src/server.ts"],
  outdir: "./dist",
  target: "bun",
  plugins: [turnoverPlugin()],
});
```

`turnoverPlugin(options?)` takes an optional `dir` to scan (default: the first entrypoint's
directory), mirroring `createApp({ dir })`.

### Option B — register controllers explicitly

If you'd rather not run a build-time scan, list your controllers in `createApp` as shown
above. Explicit registration always bundles cleanly (the imports are static) and starts
faster as the app grows, at the cost of maintaining the list yourself.

## Next steps

- [Quickstart](/getting-started/quickstart/) — see auto-discovery mount a controller with zero configuration.
- [Deployment](/guides/deployment/) — bundling, portable `fetch` handlers, and shipping to production.
