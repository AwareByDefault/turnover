---
title: Deployment
description: Deploy a Turnover app on any WinterTC runtime via app.fetch, and compose handlers with app.delegate().
sidebar:
  order: 7
---

Turnover's request pipeline is a standard WinterTC `(Request) => Promise<Response>` fetch
handler. That one fact is what lets a Turnover app run on Bun in production and deploy
unchanged on other compliant runtimes.

## The portable entry point: `app.fetch`

`app.fetch` is the [WinterTC Minimum Common API](https://min-common-api.proposal.wintertc.org/)
handler for your app — the same request path as `app.handle`, bound and ready to export.
Runtimes that look for a default export with a `fetch` method (Cloudflare Workers, Deno
Deploy, Vercel) accept it directly:

```ts title="server.ts"
import { createApp } from "turnover";

const app = await createApp({ controllers: [UsersController] });

export default app;                       // runtimes read default.fetch
// or, equivalently:
export default { fetch: app.fetch };
```

## `listen()` is Bun-only; `fetch` is runtime-agnostic

`app.listen()` starts a `Bun.serve` server and only runs on Bun. `app.fetch` carries no
Bun dependency, so it is the entry point to use on any other runtime:

```ts title="server.ts"
// Bun: run a real server
app.listen(3000);

// Anywhere WinterTC-compliant: hand app.fetch to the platform
export default { fetch: app.fetch };
```

:::caution[Auto-discovery needs a filesystem]
Zero-config controller discovery scans your source directory with `Bun.Glob`, which needs
a filesystem. On runtimes without one, don't rely on discovery — register controllers
explicitly with `createApp({ controllers: [...] })`, or bundle them with `turnoverPlugin()`.
See [auto-discovery and bundling](/guides/auto-discovery-and-bundling/).
:::

## Compose handlers with `app.delegate()`

`app.delegate(path, handler)` mounts any other WinterTC handler under a path prefix — a
raw `(Request) => Response`, or another Turnover app's `app.fetch`. The prefix is
**stripped** before the request reaches the delegate, so the sub-handler sees paths
relative to its mount point:

```ts title="server.ts"
// any WinterTC handler: a raw (Request) => Response…
const legacy = (req: Request) => Response.json({ ok: true });
app.delegate("/legacy", legacy);          // GET /legacy/anything → legacy

// …or another Turnover app (Turnover-in-Turnover)
const v2 = await createApp({ controllers: [V2Controller] });
app.delegate("/v2", v2.fetch);            // GET /v2/users → v2 sees GET /users
```

Delegation rules:

- **Longest matching prefix wins**, so more specific mounts take precedence.
- The delegate **owns its whole prefix**, including its own 404s — the parent app does not
  route inside a delegated prefix.
- The app's own response hooks still apply to the delegate's result.

You can also declare delegates at construction:

```ts title="server.ts"
const app = await createApp({
  controllers: [UsersController],
  delegate: { "/legacy": legacy },
});
```

## Next steps

- [Auto-discovery and bundling](/guides/auto-discovery-and-bundling/) — register controllers explicitly or bundle for no-filesystem runtimes.
- [The request lifecycle](/concepts/the-request-lifecycle/) — what `app.fetch` runs for every request.
- [OpenTelemetry](/guides/opentelemetry/) — add tracing before you ship.
