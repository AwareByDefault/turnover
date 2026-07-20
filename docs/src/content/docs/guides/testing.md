---
title: Testing
description: Exercise a Turnover app in-memory with app.handle, testClient, or a real OS-assigned port — no mocks, no fixtures.
sidebar:
  order: 1
---

Turnover apps are designed to be tested the way they run in production: by sending a real
`Request` through the real pipeline. There are three levels of ceremony, and you rarely
need more than the first.

## `app.handle(request)` — the whole pipeline, no socket

`app.handle(request)` runs a single `Request` through the entire request pipeline —
routing, guards, DI, validation, your handler, and response coercion — and returns a
`Response`. **No socket is opened.** Because `listen()` serves through this very method, an
in-memory `handle()` call behaves exactly like a live request.

```ts title="users.test.ts"
import { expect, test } from "bun:test";
import { createApp } from "turnover";
import { UsersController } from "./users.controller";

test("GET /users/:id returns the user", async () => {
  const app = await createApp({ controllers: [UsersController] });

  const res = await app.handle(new Request("http://local/users/1"));

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ user: { id: "1", name: "Ada" } });
});
```

Mounting with an explicit `controllers` list keeps each test isolated: the app contains
only what you name, independent of auto-discovery. This is the fastest, most direct way to
test a controller — construct the app once, then assert on `handle()` responses.

:::tip
`app.handle` is also perfect for offline tooling — extracting the OpenAPI document,
snapshotting responses, or driving the [typed client](/guides/typed-client/) in-memory —
because it never touches the network.
:::

## `testClient(app)` — an ergonomic in-memory client

For richer suites, the `turnover/testing` subpath ships `testClient`, a small wrapper over
`app.handle`. It serializes JSON bodies for you, appends query params, merges default
headers, and returns a re-readable response so you can assert on status, headers, and body
together.

```ts title="users.test.ts"
import { expect, test } from "bun:test";
import { createApp } from "turnover";
import { testClient } from "turnover/testing";
import { UsersController } from "./users.controller";

test("POST /users creates a user", async () => {
  const app = await createApp({ controllers: [UsersController] });
  const client = testClient(app, {
    headers: { authorization: "Bearer test-token" },
  });

  const res = await client.post("/users", { name: "Ada" });

  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ name: "Ada" });
});
```

`testClient(app, options?)` accepts an optional `baseUrl` (default `"http://test.local"`)
and `headers` sent on every request. It returns a `TestClient` with these methods:

- `get(path, options?)` and `delete(path, options?)`
- `post(path, body?, options?)`, `put(path, body?, options?)`, `patch(path, body?, options?)`
- `request(method, path, options?)` — the generic escape hatch (its `options` may carry a `body`)

Per-request `options` are `{ headers?, query? }`, where `query` is a
`Record<string, string | number | boolean>` appended to the path. Bodies that are plain
objects are JSON-stringified and given a `content-type: application/json` header
automatically; strings, `FormData`, `URLSearchParams`, `Blob`, and binary bodies pass
through untouched.

Every call resolves to a `TestResponse`:

```ts
interface TestResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly raw: Response;        // the underlying Response, body unread
  json<T = unknown>(): Promise<T>;
  text(): Promise<string>;
}
```

Each `json()` / `text()` call clones the response, so you can read the body more than once
across your assertions.

## `listen(0)` — a real port when you need one

When a test must go over an actual socket — verifying `fetch` interop, streaming, or a
third-party client — call `listen(0)`. Passing `0` asks the OS for a free port, which
avoids collisions when suites run in parallel. `listen()` returns Bun's
[`Server`](https://bun.sh/docs/api/http), so you get `.url`, `.port`, and `.stop()`.

```ts title="server.test.ts"
import { expect, test } from "bun:test";
import { createApp } from "turnover";
import { UsersController } from "./users.controller";

test("serves over a real port", async () => {
  const app = await createApp({ controllers: [UsersController] });
  const server = app.listen(0); // OS-assigned port

  const res = await fetch(`${server.url}users/1`);
  expect(res.status).toBe(200);

  server.stop();
});
```

Prefer `app.handle` (or `testClient`) for the vast majority of tests — it is faster and has
no port to clean up. Reach for `listen(0)` only when the socket itself is what you're
testing.

## Next steps

- [Typed client](/guides/typed-client/) — drive an app in-memory with a fully typed client via `fetch: app.handle`.
- [Controllers & routing](/concepts/controllers-and-routing/) — the `Context` object and how return values become responses.
- [The request lifecycle](/concepts/the-request-lifecycle/) — every stage a request passes through in `handle()`.
