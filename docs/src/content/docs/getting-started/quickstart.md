---
title: Quickstart
description: Define a controller, let createApp() discover it, and serve your first route in under a minute.
sidebar:
  order: 2
---

The fastest way to see Turnover work: write one controller, call `createApp()`, and
`listen()`. No registration list, no configuration.

## 1. Define a controller

A controller is a class marked with `@controller`. Each method decorated with an HTTP verb
(`@get`, `@post`, …) becomes a route. Return a value and Turnover coerces it into a
response — a plain object becomes JSON.

```ts title="hello.controller.ts"
import { controller, get } from "turnover";

@controller("/hello")
export class HelloController {
  @get("/")
  hello() {
    return { message: "Hello from turnover" };
  }
}
```

## 2. Create the app and listen

`createApp()` with no arguments **discovers** every `@controller` in your entry file's
directory tree and mounts it — there is no list of controllers to keep in sync.

```ts title="server.ts"
import { createApp } from "turnover";

const app = await createApp(); // discovers HelloController automatically
const server = app.listen(3000);

console.log(`🚀 up on ${server.url}`);
```

## 3. Run it

```bash
bun server.ts
```

Then call the route:

```bash
curl http://localhost:3000/hello
```

**You should see:**

```json
{ "message": "Hello from turnover" }
```

On boot the console also prints the discovered route table, so you can confirm
`GET /hello` was mounted.

## Prefer explicit wiring?

Auto-discovery relies on a filesystem scan. When you bundle your app, or in tests, or any
time you want explicit control, pass a `controllers` list instead — Turnover then mounts
exactly those and skips the scan:

```ts title="server.ts"
import { createApp } from "turnover";
import { HelloController } from "./hello.controller";

const app = await createApp({ controllers: [HelloController] });
app.listen(3000);
```

:::note
A naively bundled `createApp()` app boots with **zero routes**, because the bundler
tree-shakes the runtime scan away. Register controllers explicitly, or keep auto-discovery
and add the build-time plugin — see
[Auto-discovery & bundling](/guides/auto-discovery-and-bundling/).
:::

## Next steps

- [Your first API](/getting-started/your-first-api/) — build a real service, step by step.
- [Controllers & routing](/concepts/controllers-and-routing/) — routes, the `Context`
  object, and how return values become responses.
