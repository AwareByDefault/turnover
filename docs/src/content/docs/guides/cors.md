---
title: CORS
description: Answer preflight requests and add cross-origin headers with the built-in cors() plugin.
sidebar:
  order: 5
---

`cors(options?)` is a built-in plugin. It answers preflight `OPTIONS` requests and adds the
appropriate `Access-Control-*` headers to your responses — including error responses. Pass
it to `createApp` (or register it later with `app.register`).

```ts title="server.ts"
import { cors, createApp } from "turnover";

const app = await createApp({
  controllers: [...],
  plugins: [cors({ origin: "https://app.example.com", credentials: true })],
});
```

With no options, `cors()` uses permissive defaults (it reflects the request's `Origin`) —
convenient in development. Tighten `origin` before you ship.

## How it works

The plugin installs two lifecycle hooks:

- An **`onRequest`** hook that intercepts CORS preflights — an `OPTIONS` request carrying an
  `Access-Control-Request-Method` header — and answers immediately with a `204` and the
  computed CORS headers. The request never reaches a controller.
- An **`onResponse`** hook that adds `Access-Control-Allow-Origin` (and friends) to every
  cross-origin response. Because it runs on the final response, the headers are present on
  error responses too, so browsers can read your `4xx`/`5xx` bodies.

If the request has no `Origin` header, or the origin isn't allowed, no
`Access-Control-Allow-Origin` is emitted and the browser blocks the read.

## `origin`

`origin` decides which callers are allowed and what value goes into
`Access-Control-Allow-Origin`:

| Value | Behavior |
|---|---|
| `true` (default) | Reflect the request's `Origin`. Adds `Vary: Origin`. |
| `"*"` | Allow any origin verbatim. No `Vary`. |
| `"https://app.example.com"` | A single fixed origin, verbatim. Adds `Vary: Origin`. |
| `string[]` | Reflect the origin only if it is in the list; otherwise deny. |
| `(origin: string) => boolean` | Reflect the origin only when the predicate returns `true`. |
| `false` | Disable CORS headers entirely. |

```ts
// Allow a fixed allowlist:
cors({ origin: ["https://app.example.com", "https://admin.example.com"] });

// Or decide dynamically:
cors({ origin: (o) => o.endsWith(".example.com") });
```

:::caution
`Access-Control-Allow-Origin: *` cannot be combined with credentials in the browser. When
you set `credentials: true`, use a reflecting `origin` (`true`, an array, or a predicate) or
a specific origin string — not `"*"` — so the response echoes a concrete origin.
:::

## Other options

All of these are optional:

- **`methods`** — methods advertised in the preflight's `Access-Control-Allow-Methods`.
  Defaults to `GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS`.
- **`allowedHeaders`** — the `Access-Control-Allow-Headers` value. When omitted, the plugin
  reflects the preflight's `Access-Control-Request-Headers`.
- **`exposedHeaders`** — set on actual responses as `Access-Control-Expose-Headers`, so the
  browser can read those response headers from JavaScript.
- **`credentials`** — when `true`, adds `Access-Control-Allow-Credentials: true` so cookies
  and `Authorization` may be sent cross-origin.
- **`maxAge`** — how long (in **seconds**) the browser may cache the preflight result, via
  `Access-Control-Max-Age`.

```ts title="server.ts"
cors({
  origin: (o) => o.endsWith(".example.com"),
  methods: ["GET", "POST", "PATCH", "DELETE"],
  allowedHeaders: ["content-type", "authorization"],
  exposedHeaders: ["x-request-id"],
  credentials: true,
  maxAge: 86_400, // cache preflight for 24h
});
```

## Next steps

- [Lifecycle hooks & plugins](/concepts/lifecycle-hooks-and-plugins/) — how `onRequest`/`onResponse` hooks and plugins fit together.
- [Production modules](/reference/production-modules/) — CSRF, security headers, rate limiting, and the rest of the security toolkit.
