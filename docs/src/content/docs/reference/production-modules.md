---
title: Production modules
description: A map of turnover's larger production surface — auth schemes, sessions, HTTP concerns, observability, and Redis store adapters.
sidebar:
  order: 2
---

The [Public API](/reference/) reference covers the core: routing, DI, config, validation,
errors, and the request lifecycle. The barrel ships a good deal more — production feature
modules for security, HTTP concerns, observability, and storage. This page is a **map of
that surface**, not a deep manual: for each module you get its import, a one- or two-line
purpose, and how it is wired.

Three wiring shapes recur:

- **Plugins** — passed to `createApp({ plugins: [...] })` (or `app.register(...)`).
- **Injectables** — `@injectable()` classes you pull in with `inject(...)`.
- **Plain classes / helpers** — constructed with `new` or called directly.

:::note
These modules are less heavily documented than the core concepts. Signatures here are
accurate against the source, but each option interface carries more than is shown — check
the module's source and its TypeScript types for the full set of options.
:::

## Security & authentication

Compose the plugins in one `createApp` call; the injectables and plain classes are used
inside your controllers and services.

```ts title="app.ts"
import {
  createApp,
  authentication,
  bearer,
  session,
  csrf,
  securityHeaders,
} from "turnover";

const app = await createApp({
  plugins: [
    securityHeaders(),
    session(),
    csrf(),
    authentication([bearer({ verify: (token) => lookupUser(token) })]),
  ],
});
```

| Export | Import | Wiring | Purpose |
| --- | --- | --- | --- |
| `authentication` | `turnover` | plugin | Runs the given schemes on every request; the first to resolve a `Principal` attaches it (so `inject(Auth)`, `@authenticated`, `@requireRole` see it). |
| `bearer` | `turnover` | scheme → `authentication([…])` | `Authorization: Bearer <token>` scheme; you supply `verify(token) => Principal \| null`. |
| `apiKey` | `turnover` | scheme → `authentication([…])` | API-key scheme reading a header (default `x-api-key`); you supply `verify(key)`. |
| `session` | `turnover` | plugin (+ `Session` injectable) | Cookie sessions backed by a `SessionStore`; lazily created on first write. |
| `Session` | `turnover` | injectable | `inject(Session)` to read/write per-request session data (`get`/`set`/`regenerate`/`destroy`). |
| `csrf` | `turnover` | plugin | Double-submit-cookie CSRF: mints a token on safe requests, requires the echoing header on writes (403 otherwise). |
| `securityHeaders` | `turnover` | plugin | Helmet-style baseline response headers (CSP, HSTS, `X-Frame-Options`, …); each overridable or `false` to omit. |
| `requireStepUp` | `turnover` | guard factory (`@use`) | Require the session to have re-authenticated within N ms, else 401. |
| `elevate` / `clearElevation` / `elevationAge` | `turnover` | helpers | Mark, clear, and measure a session's step-up (call `elevate` after re-auth). |
| `impersonate` / `getImpersonation` / `stopImpersonation` | `turnover` | helpers | Record, read, and end admin impersonation on the session. |
| `PasswordHasher` | `turnover` | injectable | Argon2/bcrypt hashing over Bun's native `Bun.password`; `hash`, `verify`, `needsRehash`. |
| `Passwordless` | `turnover` | class (`new`) | Email OTP / magic-link one-time codes: `issue(identifier)` then `verify(identifier, code)`; codes are hashed, single-use, and expire. |
| `Totp` | `turnover` | class (`new`) | RFC 6238 time-based OTPs for MFA: `generateSecret`, `uri` (QR enrolment), `verify`. |
| `OAuth2Client` | `turnover` | class (`new`) | OAuth 2.0 / OIDC authorization-code client with PKCE: `createAuthorizationUrl`, `exchangeCode`, `refreshToken`, `fetchUserInfo`. |

Injectables come in through DI; the stateless helpers are constructed directly:

```ts
// Injectable — pull in with inject()
class Accounts {
  private readonly passwords = inject(PasswordHasher);
  async register(password: string) {
    const hash = await this.passwords.hash(password); // Argon2id by default
  }
}

// Plain classes — construct directly
const totp = new Totp();
const secret = totp.generateSecret(); // store against the user, show uri() as a QR code

const oauth = new OAuth2Client({
  clientId, clientSecret, authorizationEndpoint, tokenEndpoint, redirectUri,
  scopes: ["openid", "email"],
});
const { url, state, codeVerifier } = oauth.createAuthorizationUrl();
// redirect to `url`; on callback verify `state`, then oauth.exchangeCode({ code, codeVerifier })
```

The step-up and impersonation helpers operate on a `Session`, so they require the
`session()` plugin. See [Guards & auth](/concepts/guards-and-auth/).

## HTTP concerns

These are almost all plugins — register the ones you need:

```ts title="app.ts"
import {
  createApp,
  bodyLimit,
  compression,
  etag,
  requestId,
  rateLimit,
  serveStatic,
  multipart,
} from "turnover";

const app = await createApp({
  plugins: [
    bodyLimit(1_000_000),                          // 1 MB
    compression(),
    etag(),
    requestId(),
    rateLimit({ limit: 100, windowMs: 60_000 }),
    serveStatic({ dir: "./public" }),
    multipart({ maxFileSize: 5_000_000, allowedTypes: ["image/*"] }),
  ],
});
```

| Export | Import | Wiring | Purpose |
| --- | --- | --- | --- |
| `bodyLimit` | `turnover` | plugin | Reject a request whose `Content-Length` exceeds `maxBytes` with 413, before the body is read. |
| `compression` | `turnover` | plugin | gzip text-like responses the client accepts and that clear a size threshold. |
| `etag` | `turnover` | plugin | Add a weak `ETag` to GET `200`s and answer `304` on a matching `If-None-Match`. |
| `requestId` | `turnover` | plugin | Give each request a correlation id (reuse inbound `x-request-id` or mint one); readable via `getRequestId()` and echoed on the response. |
| `rateLimit` | `turnover` | plugin | Fixed-window rate limiting → `429` with `Retry-After`; bucket via `keyBy`, swap the counter `store` for a shared one. |
| `serveStatic` | `turnover` | plugin | Serve files from a directory before routing; a missing file falls through to the router. |
| `multipart` | `turnover` | plugin (registers a `BodyParser`) | Parse `multipart/form-data` into `{ fields, files }`, read through `ctx.body<MultipartBody>()`, with count/size/type limits. |
| `sse` | `turnover` | Response builder | Return a streaming `text/event-stream` response from a handler. |
| `SseChannel` | `turnover` | class (`new`) | A push-driven event source for `sse()`. |
| `pageParams` / `paginated` | `turnover` | helpers | Read and clamp `?page` / `?limit`; wrap results in a standard `Page` envelope. |
| `WebSocketRoute` | `turnover` | `createApp({ websocket })` | A WebSocket endpoint served alongside the HTTP routes (`upgrade`/`open`/`message`/`close`). |

`sse`, `multipart`, pagination, and WebSocket are used from inside handlers rather than as
plugins:

```ts
// SSE — return the stream straight from a handler
@get("/events")
events() {
  return sse(async function* () {
    yield { event: "tick", data: { n: 1 } };
    yield { data: "done" };
  });
}

// Multipart — parse the body like any other
const { fields, files } = await ctx.body<MultipartBody>();

// Pagination — read params, return an envelope
const p = pageParams(ctx.query);
return paginated(rows, total, p); // { data, page, limit, total, totalPages }
```

```ts title="ws.ts"
const app = await createApp({
  websocket: {
    path: "/ws",
    upgrade: (req) => ({ user: new URL(req.url).searchParams.get("user") ?? "anon" }),
    open: (ws) => ws.send(`welcome ${ws.data.user}`),
    message: (ws, msg) => ws.send(`echo: ${msg}`),
  },
});
```

WebSocket connections are Bun's `ServerWebSocket`, so `listen()` (Bun) upgrades them.

## Observability & ops

```ts title="app.ts"
import { createApp, requestId, metrics, health, problemDetails } from "turnover";

const app = await createApp({
  plugins: [
    requestId(),
    metrics(),                                                   // GET /metrics
    health({ checks: [{ name: "db", check: () => db.ping() }] }), // /health, /ready
    problemDetails(),                                            // RFC 9457 errors
  ],
});
```

| Export | Import | Wiring | Purpose |
| --- | --- | --- | --- |
| `health` | `turnover` | plugin | Mount `/health` (liveness) and `/ready` (readiness, aggregating checks → `200`/`503`). |
| `HEALTH_CHECK` | `turnover` | token (multi-inject) | Bind readiness checks that `health()` collects from the container. |
| `problemDetails` | `turnover` | plugin | Render errors as RFC 9457 `application/problem+json` instead of the default envelope. |
| `metrics` | `turnover` | plugin (+ `MetricsRegistry`) | Auto-instrument HTTP traffic and expose Prometheus metrics at `/metrics`; `inject(MetricsRegistry)` for custom metrics. |
| `Counter` / `Gauge` / `Histogram` / `MetricsRegistry` | `turnover` | classes | Build and record custom Prometheus metrics. |
| `Logger` | `turnover` | injectable | Structured JSON logs auto-stamped with the current request id; bind `LOG_SINK` / `LOG_LEVEL` to reconfigure. |
| `JobQueue` | `turnover` | class (`new`) | In-process background jobs with retries, exponential backoff, delays, and a dead-letter list. |
| `Mailer` | `turnover` | class (`new`) | Transport-agnostic email sender; ships `memoryTransport()` for tests and dev. |

`Logger` is `@injectable()`, so it resolves without registration; `JobQueue` and `Mailer`
are plain classes you construct (or register as providers):

```ts
// Logger — inject it anywhere
class Orders {
  private readonly log = inject(Logger);
  place() {
    this.log.info("order placed", { total: 42 }); // JSON line, stamped with the request id
  }
}

// JobQueue — register handlers, enqueue, drain
const jobs = new JobQueue();
jobs.on("email", async ({ to }) => sendEmail(to));
await jobs.enqueue("email", { to: "ada@acme.io" });
jobs.start(); // or call jobs.process() yourself in tests

// Mailer — validates and delivers
const mailer = new Mailer({ from: "Acme <no-reply@acme.io>" });
await mailer.send({ to: "ada@acme.io", subject: "Hi", text: "Welcome!" });
```

## Storage adapters

The `turnover/redis` subpath provides Redis-backed implementations of the framework's
async pluggable stores, so sessions, cached values, one-time codes, and jobs survive
restarts and are shared across replicas. The adapters are **dependency-free**: you pass in
any client satisfying a small `RedisClient` interface (Bun's built-in `redis`, `ioredis`,
`node-redis`, …) — turnover never imports a Redis library.

```ts title="app.ts"
import { redis } from "bun";
import { createApp, session } from "turnover";
import { redisSessionStore } from "turnover/redis";

const app = await createApp({
  plugins: [session({ store: redisSessionStore(redis, { ttl: 86_400 }) })],
});
```

| Export | Import | Implements | Wire into |
| --- | --- | --- | --- |
| `redisSessionStore` | `turnover/redis` | `SessionStore` | `session({ store })` |
| `redisCacheStore` | `turnover/redis` | `CacheStore` | `CACHE_STORE` provider / `@cacheable` |
| `redisOtpStore` | `turnover/redis` | `OtpStore` | `new Passwordless({ store })` |
| `redisJobStore` | `turnover/redis` | `JobStore` | `new JobQueue({ store })` |

Each factory also exports its client interface (`RedisClient`, `RedisCacheClient`,
`RedisJobClient`) and options interface, so you can type a custom client or key prefix.

## Next steps

- [Public API](/reference/)
- [Guards & auth](/concepts/guards-and-auth/)
- [Error handling](/concepts/error-handling/)
- [Deployment](/guides/deployment/)
</content>
