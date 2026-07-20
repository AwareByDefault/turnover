# turnover

## 0.38.1

### Patch Changes

- 79d4ced: Document the entire public API with TSDoc, and enforce it. Every exported symbol
  and public member now carries a doc summary, and callables document each parameter,
  type parameter, and return value — so the docs consumers see in their editor (via
  the shipped `.d.ts`) are complete.

  This is mechanically enforced going forward: a new `tsdoc-coverage` lint check
  derives the public surface from `package.json` `exports`, reads the emitted `.d.ts`,
  and fails on any undocumented symbol or any callable missing an `@param`,
  `@typeParam`, or `@returns` (coding §6.3, §6.4). A build smoke test re-verifies the
  docs survive `tsc` into the published types at 100% coverage.

## 0.38.0

### Minor Changes

- 00f4176: `@repository` is now transactional by default: every instance method runs inside
  the bound `TransactionManager` (commit on success, roll back on throw), so a DAO
  is a unit of work without annotating each method. To avoid making every data
  call async when transactions aren't configured, `@transactional`/`@repository`
  now pass through unchanged when no manager is bound — a synchronous method stays
  synchronous. Once a `TransactionManager` is bound, those methods run in it and
  return promises (breaking, but only for apps that opt into transactions; allowed
  pre-1.0). Use `@service`/`@injectable` for a non-transactional component.

## 0.37.0

### Minor Changes

- a688a89: `health()` now auto-collects readiness checks from the container. Bind a
  `HealthCheck` (a value or an `@injectable` class that implements it) to the new
  `HEALTH_CHECK` multi-injection token and `/ready` aggregates every one alongside
  any passed explicitly — so an indicator can `inject()` its own dependencies
  instead of being wired by hand. Enabled by a new optional `onInit(container)`
  plugin hook, which runs once at registration (after providers are bound) so any
  plugin can resolve DI-registered collaborators.

## 0.36.0

### Minor Changes

- 9efe70e: Make `JobStore` async so a durable backend can back `JobQueue`, and ship
  `redisJobStore()` at `turnover/redis`. Its methods return promises,
  `memoryJobStore` implements the async shape, and `JobQueue.enqueue`, `failed`,
  and `pending` now return promises.

  Breaking (pre-1.0): `await queue.enqueue(...)`, `await queue.failed()`, and
  `await queue.pending()`; custom `JobStore` implementations must return promises.
  `redisJobStore(client)` stores the job set in one Redis hash (a small
  `hset`/`hgetall`/`hdel` client) — durable, shared across replicas, with
  completed jobs pruned. Previously deferred for the sync-interface constraint —
  now unblocked.

## 0.35.0

### Minor Changes

- a8aa3ce: Make `CacheStore` async so a shared backend can back `@cacheable`, and ship
  `redisCacheStore()` at `turnover/redis`. `CacheStore.get`/`set`/`delete`/`clear`
  now return promises, `MemoryCache` implements the async shape, and a `@cacheable`
  (or `@cacheEvict`) method now always returns a `Promise` — `await` it even when
  the body is synchronous.

  Breaking (pre-1.0): callers of `@cacheable` methods must add `await`, and custom
  `CacheStore` implementations must return promises. `redisCacheStore(client)`
  takes any client with `get`/`set`/`del`/`expire`/`keys`; `clear()` removes only
  the store's prefixed keys.

## 0.34.0

### Minor Changes

- e277474: Add WebSocket support. Register a `WebSocketRoute` via `createApp({ websocket })`
  or `app.websocket(route)` and `listen()` serves it alongside the HTTP routes:
  matching upgrade requests are accepted (with an `upgrade(req)` hook to
  authenticate and attach typed `ws.data`, or reject with `401`), and `open` /
  `message` / `close` / `drain` lifecycle callbacks receive Bun's native
  `ServerWebSocket`. Everything else keeps routing through `handle()` unchanged.

## 0.33.0

### Minor Changes

- d08a227: Add a `turnover/codegen` subpath with `generateClient()` — generate a
  self-contained, dependency-free typed TypeScript client from an OpenAPI document
  (such as the one `app.openapi()` produces). Each operation becomes a method
  typed from its path/query parameters, request body, and 2xx response schema; the
  generated client builds the URL, query string, and JSON body and calls an
  injectable `fetch`. Run it at build time (a four-line CLI wrapper is shown in the
  docs) and commit or bundle the output.

## 0.32.0

### Minor Changes

- faf080c: Add a `turnover/redis` subpath with `redisSessionStore()` and `redisOtpStore()`
  — Redis-backed adapters for the async `SessionStore` and `OtpStore`, so sessions
  and passwordless codes survive restarts and are shared across replicas. Both are
  dependency-free: you pass any client satisfying a small four-method `RedisClient`
  interface (Bun's built-in redis, ioredis, node-redis, …) — turnover never
  imports a Redis library. Session writes take an optional TTL; OTP entries get a
  Redis TTL matching each code's own expiry.

## 0.31.0

### Minor Changes

- b296d6e: Add step-up authentication and impersonation helpers over `session()`.
  `requireStepUp({ within })` is a guard that gates a sensitive route behind recent
  re-authentication (401 otherwise); mark a fresh re-auth with `elevate()` and
  inspect it with `elevationAge()`/`clearElevation()`. For privileged access,
  `impersonate()`/`getImpersonation()`/`stopImpersonation()` record an actor acting
  as another user while preserving the actor's own identity for audit and reversal.

## 0.30.0

### Minor Changes

- 4a59760: Add `OAuth2Client` — a minimal OAuth 2.0 / OIDC authorization-code client with
  PKCE for social and enterprise sign-in. `createAuthorizationUrl()` builds a login
  URL with a fresh `state` and S256 code challenge; `exchangeCode()` swaps the code
  (and PKCE verifier) for tokens; `refreshToken()` renews them; `fetchUserInfo()`
  reads the OIDC profile. Endpoints are configured generically (works with any
  conformant provider), client authentication supports `body` or HTTP `basic`, and
  network calls go through an injectable `fetch`. Dependency-free.

## 0.29.0

### Minor Changes

- 26b393b: Add a `turnover/testing` subpath with `testClient()` — an ergonomic in-memory
  client that routes requests through an app's `handle` with no socket. JSON
  bodies are serialized and content-typed automatically; strings, `FormData`, and
  binary bodies pass through untouched; default and per-request headers merge; and
  responses are re-readable so status, headers, and body can all be asserted.
  Kept out of the main barrel so it never ships in a production bundle.

## 0.28.0

### Minor Changes

- 7ce4bc9: Add `Passwordless` — passwordless authentication via one-time codes (email OTP
  or magic-link tokens). `issue()` a code for an identifier and send it yourself
  (e.g. with `Mailer`); `verify()` the submitted code. Codes are stored only as
  SHA-256 hashes, expire after a configurable `ttl`, are single-use (consumed on
  success, constant-time comparison), and burn after `maxAttempts` wrong tries.
  Supply a `generateCode` for long URL-safe magic-link tokens instead of numeric
  OTPs. Pluggable `OtpStore` with an in-memory default.

## 0.27.0

### Minor Changes

- 2ede079: Add `Mailer` — a transport-agnostic email sender. Normalizes and validates a
  `Mail` (recipient fields to arrays, default `from`, at least one recipient and a
  `text`/`html` body) then hands it to a pluggable `MailTransport`. Ships
  `memoryTransport()` (captures messages for tests and dev); plug an SMTP or API
  transport in production. Zero runtime dependencies — real transports stay the
  consumer's choice.

## 0.26.0

### Minor Changes

- e1aa8c3: Add `JobQueue` — an in-process background job queue with retries, exponential
  backoff, delays, and a dead-letter list. Register a handler per job `type`,
  `enqueue()` work, and drain it either deterministically with `process()` (ideal
  in tests, via an injectable clock) or by letting `start()` poll on an interval.
  A throwing handler reschedules with backoff until its attempts are exhausted,
  then lands in `failed()`. Storage is pluggable (`JobStore`) with an in-memory
  default.

## 0.25.0

### Minor Changes

- 32200d3: Add `sse()` — build a streaming `text/event-stream` response from an async
  source, returnable straight from a route handler. Accepts an async generator (or
  any async iterable) of `SseEvent`s (`data`/`event`/`id`/`retry`), serializing
  each to the wire format (string payloads verbatim, others JSON, multi-line
  payloads split across `data:` lines) with an optional comment heartbeat. Ships
  `SseChannel`, a push-driven async source for event-bus/pub-sub streams that
  drains queued events before closing.

## 0.24.0

### Minor Changes

- 0eec7a0: Add `Totp` — RFC 6238 time-based one-time passwords for MFA. A stateless,
  dependency-free (Node crypto) helper to `generateSecret()`, build an
  `otpauth://` provisioning `uri()` for authenticator-app enrolment, produce a
  `code()`, and `verify()` a submitted token with configurable clock-skew
  tolerance (`±window` steps) and constant-time comparison. Configurable period,
  digits, and algorithm (SHA1/256/512); verified against the RFC 6238 test
  vectors. Pairs with `PasswordHasher` for a second factor.

## 0.23.0

### Minor Changes

- 4308331: Add `multipart()` — parse `multipart/form-data` bodies into `{ fields, files }`,
  readable through `ctx.body<MultipartBody>()` like any other body. Each upload is
  an `UploadedFile` (field, filename, type, size, `bytes()`/`text()`). Enforces
  optional `maxFiles`, `maxFileSize`, `maxTotalSize`, and `allowedTypes`
  (exact or `image/*` wildcard) limits up front — using each file's known size
  without buffering — rejecting violations with `400`/`413`/`415`.

## 0.22.0

### Minor Changes

- 9670f56: Add `metrics()` — Prometheus metrics with automatic HTTP instrumentation. Ships
  a dependency-free `MetricsRegistry` (`Counter`/`Gauge`/`Histogram`) that renders
  the text exposition format, and a plugin recording `http_requests_total`,
  `http_request_duration_seconds`, and `http_requests_in_flight` — labelled by
  method, route pattern (low cardinality), and status — served at `/metrics`
  before routing so scrapes aren't self-counted. Share a registry with the plugin
  and bind it as a provider to record custom application metrics. Completes the
  observability triad alongside logging and tracing.

## 0.21.0

### Minor Changes

- 97cf2b9: Add `PasswordHasher` — an injectable password hasher over Bun's native
  Argon2/bcrypt. Sensible defaults (Argon2id), cost configurable via the
  `PASSWORD_OPTIONS` DI token, a `verify()` that returns `false` for a malformed
  hash instead of throwing, and `needsRehash()` to transparently upgrade a stored
  hash on the user's next login. Completes the credential half of the login flow
  alongside `session()`.

## 0.20.0

### Minor Changes

- 15f9d03: Add `session()` — cookie-based sessions backed by a pluggable `SessionStore`.
  The plugin loads the session named by the id cookie, exposes it through the
  injectable `Session` accessor (`get`/`set`/`delete`/`clear`/`regenerate`/
  `destroy`), and persists changes afterwards: sessions are created lazily (an
  anonymous request that never writes gets no cookie and no store entry), the
  `HttpOnly` `SameSite=Lax` cookie is set on first write and expired on
  `destroy()`, and `regenerate()` rotates the id post-authentication to defend
  against fixation. Ships `memorySessionStore({ ttl? })`; the async `SessionStore`
  interface lets a shared backend (Redis, a database) drop in. Pairs with a
  `@derive` that maps the session to `setPrincipal(...)` for authorization.

## 0.19.0

### Minor Changes

- 612be02: Add `serveStatic()` — serve files from a directory before routing. A
  `GET`/`HEAD` under the configured `prefix` maps to a file in `dir` (with the
  `Content-Type` inferred from the extension), a directory request serves the
  `index` file, a missing file falls through to the router (404), and a path that
  escapes the root via `..` is refused with `403`. Optional `Cache-Control`.

## 0.18.0

### Minor Changes

- 642ab1b: Add `csrf()` — CSRF protection via the double-submit-cookie pattern. Safe
  requests mint a random, `SameSite=Strict`, JS-readable token cookie; unsafe
  requests must echo it in a matching header (default `x-csrf-token`) or get
  `403 Forbidden`. Cookie name, header name, safe-method set, and cookie
  attributes are configurable.

## 0.17.0

### Minor Changes

- 07d0e1d: Add `bodyLimit()` — reject oversized request bodies.

  - **`bodyLimit(maxBytes)`** is a plugin that rejects a request whose `Content-Length` exceeds the limit with `413 Payload Too Large`, before the body is read — a cheap first-line guard against oversized uploads. (Chunked requests that omit `Content-Length` pass this check; enforce those in a streaming parser.)

## 0.16.0

### Minor Changes

- e02d5b2: Add `compression()` — gzip response compression.

  - **`compression()`** is a plugin that gzip-compresses text-like responses (JSON, HTML, XML, `text/*`) when the client sends `Accept-Encoding: gzip` and the body is over a threshold (default 1 KB). It sets `Content-Encoding: gzip` and `Vary: Accept-Encoding`, and skips already-encoded, small, or non-text responses.
  - The `threshold` and the set of compressible content-`types` are configurable. Exposes `compression` and `CompressionOptions`.

## 0.15.0

### Minor Changes

- be7a82f: Add `rateLimit()` — request rate limiting.

  - **`rateLimit({ limit, windowMs })`** is a plugin that limits how many requests a client may make in a time window, replying `429 Too Many Requests` (with `Retry-After`) once the limit is exceeded; every response carries `X-RateLimit-Limit` / `X-RateLimit-Remaining`.
  - Bucket clients with `keyBy(ctx)` (default: the `X-Forwarded-For` header, else a shared bucket). The default counter is an in-memory fixed window; swap in a shared `store` (e.g. Redis) for a multi-instance deployment. Exposes `rateLimit`, `memoryRateLimitStore`, `RateLimitOptions`, and `RateLimitStore`.

## 0.14.0

### Minor Changes

- 7898c0b: Add `securityHeaders()` — a baseline of security response headers.

  - **`securityHeaders()`** is a plugin that sets a helmet-style default on every response: `Content-Security-Policy` (`default-src 'self'`), `Strict-Transport-Security`, `X-Frame-Options` (`DENY`), `Referrer-Policy` (`no-referrer`), `Cross-Origin-Opener-Policy` (`same-origin`), and `X-Content-Type-Options` (`nosniff`).
  - Each header is overridable, or set to `false` to omit it. It never clobbers a header a handler already set. Exposes `securityHeaders` and `SecurityHeadersOptions`.

## 0.13.0

### Minor Changes

- b1cde91: Add the authentication stage — `authentication()`, `bearer()`, `apiKey()`.

  - **`authentication(schemes)`** is a plugin that runs registered schemes on every request in order; the first to resolve a principal attaches it to the request, so `inject(Auth).user`, `@authenticated`, and `@requireRole` see it, and an unrecognised request is simply anonymous. This is authentication "baked in" — you provide the credential-parsing strategies, and authorization lives on the controller.
  - **`bearer({ verify })`** reads `Authorization: Bearer <token>` (JWTs or opaque tokens); **`apiKey({ verify, header? })`** reads an API key from a header (default `x-api-key`). Both call your `verify` to turn the credential into a principal.
  - An `AuthScheme` is `{ name, authenticate(ctx) → Principal | null }` — implement one for any credential type. Exposes `authentication`, `bearer`, `apiKey`, `AuthScheme`, `BearerOptions`, `ApiKeyOptions`.

## 0.12.0

### Minor Changes

- e40e653: Add authorization decorators — `@authenticated`, `@requireRole`, `@requireScope`, `@authorize`.

  - **`@authenticated`** (class or method) requires an authenticated principal, else `401` — sugar for `@use(requireAuth)`.
  - **`@requireRole(...roles)`** / **`@requireScope(...scopes)`** require the principal to hold at least one of the given roles/scopes (on `principal.roles` / `principal.scopes`), else `403` (or `401` if unauthenticated).
  - **`@authorize((principal, ctx) => boolean | Promise<boolean>)`** is the generic escape hatch — ownership, tenancy, or any policy; `403` when it rejects.
  - All read the principal that authentication set, so access rules live on the controller next to the code they guard (class-level authentication runs before method-level authorization). Exposed from the barrel and `turnover/auth`.

## 0.11.0

### Minor Changes

- 46e4fb7: Add `app.docs()` — serve the OpenAPI spec and an interactive docs page.

  - **`app.docs(options?)`** mounts `GET /openapi.json` (the document from `app.openapi()`) and, unless disabled, `GET /docs` (an interactive API reference UI), turning the OpenAPI generation the framework already does into live, browsable docs. Chain it after `createApp`: `const app = (await createApp()).docs()`.
  - Paths are configurable (`jsonPath`, `uiPath`); set `uiPath: false` to serve only the JSON. `openapi` options (info, servers, `toJsonSchema`) pass straight through. Adds the `DocsOptions` type.

## 0.10.0

### Minor Changes

- 51a13d8: `app.listen()` reads the environment and shuts down gracefully.

  - **`listen()`** now defaults the port to the `PORT` environment variable (then `3000`) and the bind address to `HOST`, so a container or platform can place the server without code changes. An explicit `listen(port)` still wins.
  - By default it installs `SIGTERM`/`SIGINT` handlers that run `app.stop()` — draining in-flight requests, firing `onStop`, and disposing `@preDestroy` — then exit cleanly, so a deploy or `Ctrl+C` no longer drops requests. The handlers are removed on `stop()`, and can be disabled with `listen(port, { signals: false })`.
  - Adds the `ListenOptions` type (`hostname`, `signals`).

## 0.9.0

### Minor Changes

- 83b2c5e: Add `problemDetails()` — RFC 9457 error responses.

  - **`problemDetails()`** is a plugin that renders errors as [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json` instead of the default JSON envelope. An `HttpError` becomes a problem document with its `status`, a `title`, the message as `detail`, the request path as `instance`, and any `code`/`details` as extension members; an unknown error becomes an opaque `500` whose message is never leaked.
  - Opt-in via `plugins: [problemDetails()]`, so existing error shapes are unchanged until you add it. Exposes `problemDetails` and the `ProblemDocument` type.

## 0.8.0

### Minor Changes

- 4d3ed77: Add pagination helpers — `pageParams` and `paginated`.

  - **`pageParams(query, options?)`** reads `?page` (1-based) and `?limit` from a request's query string into normalized, clamped `{ page, limit, offset }` — invalid or missing values fall back to defaults, `limit` is bounded by `maxLimit` so a client can't request an unbounded page, and `offset` is ready for slicing or SQL `OFFSET`.
  - **`paginated(data, total, params)`** wraps a page of results in a standard `{ data, page, limit, total, totalPages }` envelope.
  - Exposes `pageParams`, `paginated`, `Page`, `PageParams`, and `PageOptions`.

## 0.7.0

### Minor Changes

- dfc920a: Add `Logger` — a structured, injectable logger.

  - **`Logger`** logs structured records with `debug`/`info`/`warn`/`error(msg, fields?)`. It is quiet by default — only records at or above the minimum level (`info` unless `LOG_LEVEL` says otherwise) are emitted — and every record is automatically stamped with the current request's id (from `requestId()`), so logs correlate to requests without threading a `ctx` through.
  - Records are JSON to stdout (warnings/errors to stderr) by default; bind a `LOG_SINK` provider to route them elsewhere (a file, a collector, a test spy). The level can be set with the `LOG_LEVEL` token or the `LOG_LEVEL` environment variable.
  - Exposes `Logger`, `LOG_SINK`, `LOG_LEVEL`, `LogLevel`, `LogRecord`, and `LogSink`.

## 0.6.0

### Minor Changes

- 4ef5c5a: Add `etag()` — HTTP caching with conditional requests.

  - **`etag()`** is a plugin that attaches a weak `ETag` to cacheable responses and answers `304 Not Modified` when the client's `If-None-Match` matches — so an unchanged body costs a hash and an empty response instead of re-sending it.
  - Applies to `200` responses of the configured methods (`GET` by default); other statuses and methods are left untouched. The tag is derived from the response body, so it is stable across identical responses. Distinct from `@cacheable`, which memoizes compute rather than transport.
  - Exposes `etag` and `EtagOptions`.

## 0.5.0

### Minor Changes

- eb0303c: Add `health()` — liveness and readiness probes.

  - **`health()`** is a plugin that mounts two probe endpoints. `/health` answers `200 {status:"up"}` whenever the process is serving (liveness). `/ready` runs every registered check and answers `200` when all pass or `503` when any fails (readiness), with a per-check breakdown — the shape a load balancer or orchestrator expects.
  - Checks are `{ name, check: () => boolean | Promise<boolean> }`; a falsy result or a throw marks a check down. Probe paths are configurable (`livenessPath`/`readinessPath`). Served via an `onRequest` short-circuit, so no controller is needed and other routes are untouched.
  - Exposes `health`, `HealthCheck`, and `HealthOptions`.

## 0.4.0

### Minor Changes

- b83ef2e: Add `requestId()` — request correlation ids.

  - **`requestId()`** is a plugin that gives every request a correlation id: it reuses an inbound `x-request-id` header (so an id set by a gateway or upstream service flows through) or mints one with `crypto.randomUUID()`, and echoes it on the response.
  - **`getRequestId()`** reads the current request's id anywhere — handlers, injected services, and log lines — without threading a `ctx` through. The header name and generator are configurable via `RequestIdOptions`.
  - Exposes `requestId`, `getRequestId`, `setRequestId`, and `RequestIdOptions`; adds an optional `requestId` field to `RequestState`.

## 0.3.0

### Minor Changes

- b9ee6b0: Add `@configProperties` — typed, validated configuration binding.

  - **`@configProperties(schema)`** binds a class's fields to environment variables by naming convention (`DATABASE_URL` → `databaseUrl`) and validates the whole object through a Standard Schema when the class is constructed, failing fast with a `ConfigValidationError` that lists the offending fields. The validated (and coerced) result is assigned onto the instance, which is an injectable singleton — `inject(Settings).port` is a real, checked `number` instead of a stringly-typed `value("PORT", …)` read.
  - Reads from `Bun.env` by default; a `CONFIG_SOURCE` provider or `createApp({ config })` overrides it. An optional `prefix` binds only variables under a namespace (`APP_`). The schema must validate synchronously.
  - Adds an optional `entries()` to `ConfigSource` (implemented by the built-in env and record sources) so the whole source can be enumerated. Exposes `configProperties`, `ConfigValidationError`, and `ConfigPropertiesOptions`.

## 0.2.0

### Minor Changes

- 3d767aa: Expose the decorator-metadata helpers so consumers can build their own AOP decorators and plugins with the same primitives the built-ins use.

  - **`decoratorMeta(context)`** — the shared metadata bag for the class being decorated (from a decorator's `context`).
  - **`classMeta(target)`** — the metadata bag attached to a class at runtime (`Class[Symbol.metadata]`), for inspecting a class inside a container post-processor.
  - **`MetaBag`** — the bag's type.

  Together with the already-public `addAround`, `around`/`before`/`after`, `aspectProcessor`, `Container.addPostProcessor`, and the `Plugin`/`wrap` surface, these let a consumer rebuild something like the `turnover/otel` plugin (class-level `@traced` + `@noTrace` opt-out) entirely from the public API — no internal imports.

- 3d767aa: Add `turnover/bundler` — make auto-discovery survive bundling.

  Auto-discovery uses a runtime filesystem scan, which a bundler tree-shakes away, so a naively bundled `createApp()` app boots with zero routes. The new build-time helpers fix that:

  - **`turnoverPlugin()`** — a `Bun.build` plugin that runs the same scan at build time and injects the discovered `@controller` files into the entrypoint (marking them side-effectful so they aren't tree-shaken). Your entry keeps calling `createApp()` with no arguments — no source changes:

    ```ts
    import { turnoverPlugin } from "turnover/bundler";
    await Bun.build({
      entrypoints: ["./src/server.ts"],
      outdir: "dist",
      target: "bun",
      plugins: [turnoverPlugin()],
    });
    ```

  - **`scanControllerFiles(dir)`** — the underlying scan (absolute paths of every `@controller` file), for generating your own manifest if you prefer explicit registration.

  The core stays dependency-free (this is a separate subpath, importing only `bun`/`node` types). `test/bundle-smoke.test.ts` proves it end-to-end by building and cURLing a bundled server.

- 3d767aa: Add configuration/environment injection and profiles.

  - **`Config`** service + **`value(key, fallback)`** / **`requireValue(key)`** helpers read configuration, coercing to the fallback's type (`string`/`number`/`boolean`). Reads `Bun.env` by default; override with **`createApp({ config })`** (a plain object or a `ConfigSource`) or a `CONFIG_SOURCE` provider. `Config` also has `require`/`has`.
  - **Profiles**: set active profiles via `createApp({ profiles })` (defaults from `TURNOVER_PROFILES` or `NODE_ENV`). **`@profile(...names)`** mounts a controller or module only when one of its profiles is active; `Config.hasProfile(name)` reads them.
  - Adds **`Container.resolveOptional(token, fallback)`** / **`injectOptional(token, fallback)`** (return a fallback when an `InjectionToken` is unbound), used by `Config`.
  - Exposes `Config`, `ConfigSource`, `EnvConfigSource`, `CONFIG_SOURCE`, `ACTIVE_PROFILES`, `value`, `requireValue`, `profile`, and `injectOptional`.

- 3d767aa: Add an `onResponse` hook, a plugin mechanism, and a built-in CORS plugin.

  - **`onResponse(res, req)`** runs after every response (including 404s and errors) and may return a `Response` to replace it or mutate its headers. Register via `createApp({ onResponse })` or `app.onResponse()`. Full per-request order is now **onRequest → derivers → guards → interceptors → validation → handler → onResponse → response**.
  - **Plugins** — a `Plugin` is a bundle of hooks (`onRequest`/`onResponse`/`onStart`/`onStop`/`onError`). Register with `app.register(plugin)` or `createApp({ plugins: [...] })`.
  - **`cors(options)`** — a built-in plugin that answers preflight `OPTIONS` requests and adds CORS headers to responses. `origin` accepts `true` (reflect, default), a string (`"*"` or fixed), an array/predicate (reflect on match), or `false`; plus `methods`, `allowedHeaders`, `exposedHeaders`, `credentials`, and `maxAge`.
  - Exposes `ResponseHook`, `Plugin`, `App.onResponse`, `App.register`, `cors`, and `CorsOptions`.

- 3d767aa: Add DI provider strategies — bind tokens to values, classes, factories, and aliases.

  - **`InjectionToken<T>`** for non-class dependencies (interfaces, config values, multi-impl services).
  - **`Container.register(token, provider)`** with `useValue` / `useClass` / `useFactory` (receives the container) / `useExisting` (alias). `useClass`/`useFactory` take an optional `scope`.
  - **`createApp({ providers: [{ provide, useValue | useClass | useFactory | useExisting }] })`** registers providers before controllers mount. Register imperatively via `app.container.register(...)`.
  - **Overriding**: the last registration for a token wins for `resolve()`/`inject()` (handy for test mocks). **Multi-injection**: `Container.resolveAll(token)` / `injectAll(token)` return every binding.
  - Concrete `@injectable` classes still auto-construct without registration (unchanged). Exposes `InjectionToken`, `Token`, `Provider`, `ProviderDef`, and `injectAll`.

- 3d767aa: Add HTTP error types and a customizable error-handling pipeline.

  - **`HttpError`** and named subclasses (`BadRequestError`, `UnauthorizedError`, `PaymentRequiredError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `GoneError`, `UnprocessableEntityError`, `TooManyRequestsError`, `InternalServerError`). Throw one from a handler or guard and it renders as a JSON envelope (`{ error: { message, code?, details? } }`) with the right status. Extend `HttpError` for domain errors.
  - **Error handlers** map thrown values to responses. An `ErrorHandler` returns a `Response` to handle the error or nothing to defer to the next in the chain — **route → controller → global → framework default**. Register scoped handlers with the `@catchError(...)` decorator (class or method) and global handlers via `createApp({ onError })` or `app.onError(...)`.
  - **Safe defaults**: a thrown value that isn't an `HttpError` becomes an opaque `500` (its message is never leaked to the client) and is logged; a thrown `Response` still passes through unchanged. `handle()` now always resolves to a `Response` — handler/guard errors no longer reject it.
  - Unmatched routes (`404`) and unsupported methods (`405`, with an `Allow` header) now return the same JSON error envelope.

- 3d767aa: Add an in-process event bus for decoupling.

  - **`Events`** (injectable) — `publish(event)` dispatches an event object to every subscriber of its class and awaits them all; `on(type, listener)` subscribes and returns an unsubscribe function. A failing listener is logged, not propagated.
  - **`@onEvent(EventType)`** subscribes a service method; it registers when the service is constructed. List listener services in **`createApp({ listeners })`** to construct them eagerly (when nothing else injects them).
  - Exposes `Events`, `onEvent`, `EventType`, and `EventListener`.

- 3d767aa: Expose `turnover/auth` and `turnover/request` as package subpaths so consumers can augment the framework's `Principal` and `RequestStore` interfaces the way a published package requires (`declare module "turnover/auth"`).

  The framework source now lives directly under `src/` (was `src/framework/`), and the runnable demo moved to a top-level `example/` folder that is **not** part of the published package.

- 3d767aa: Add `@postConstruct` / `@preDestroy` bean lifecycle callbacks.

  - **`@postConstruct`** (method decorator) runs right after the container constructs a service (once field initializers have run). Sync hooks run inline; **async hooks are awaited at bootstrap** via `container.init()`, which `createApp` now calls after mounting — so a service that opens a pool/connection is ready before you serve.
  - **`@preDestroy`** (method decorator) runs when the app stops: `app.stop()` now calls `container.dispose()`, invoking `@preDestroy` hooks in **reverse construction order**. A failing hook is logged and doesn't stop the others.
  - Exposes `postConstruct`, `preDestroy`, and the `Container.init()` / `Container.dispose()` methods.

- 3d767aa: Add around-advice interceptors and app lifecycle hooks.

  - **`@intercept(...)`** (controller or route) wraps a handler with around advice: an `Interceptor` receives `ctx` and a `next()` that runs the rest of the chain and returns its `Response`. Run code before/after, transform the response, short-circuit by skipping `next()`, or catch errors from it. Interceptors nest — controller-level wraps method-level, and a module's `intercept` wraps both. They run after guards, around validation and the handler. `@module` gains an `intercept` option.
  - **Lifecycle hooks** — `onRequest(req)` runs before routing on every request (return a `Response` to short-circuit, e.g. CORS); `onStart(server)` runs once after `listen()`; `onStop()` runs on `app.stop()`, which then closes the server. Register via `createApp({ onRequest, onStart, onStop })` or `app.onRequest()` / `app.onStart()` / `app.onStop()`.
  - Full per-request order: **onRequest → derivers → guards → interceptors → validation → handler → response**.
  - Exposes `intercept`, `Interceptor`, `RequestHook`, `StartHook`, `StopHook`, and `App.stop()`.

- 3d767aa: Add `@resolve`, `onAfterResponse`, and `onTrace` lifecycle phases.

  - **`@resolve(...)`** (controller or route) is like `@derive` but runs **after validation**, so it can read `ctx.valid` — e.g. load the entity named by a now-validated `:id` and put it on `ctx.store`. Order is now derivers → guards → validation → **resolvers** → handler.
  - **`onAfterResponse(res, req)`** runs **fire-and-forget** after each response (including 404s/errors) so telemetry never delays the response.
  - **`onTrace(event)`** reports each request's `{ req, response, durationMs }`.
  - All three register via `createApp({ onAfterResponse, onTrace })` / `app.onAfterResponse()` / `app.onTrace()`, and `onAfterResponse`/`onTrace` via a `Plugin`. Exposes `resolve`, `AfterResponseHook`, `TraceHook`, and `TraceEvent`.

- 3d767aa: Add macros — named, parameterized, DI-resolvable cross-cutting bundles.

  - **`defineMacro(name, factory)`** registers a macro whose factory returns a bundle of hooks (`use` / `derive` / `intercept` / `catchError`). **`@macro(name, ...args)`** (controller or route) applies it, expanding into the same pipeline as the individual decorators.
  - The factory runs **in an injection context at mount time**, so it can `inject()` services and close over them — the DI + cross-cutting "fusion". Class- and method-level macros both apply, and multiple compose.
  - Unknown macro names throw at mount. Adds `Container.runInContext(fn)` (run a function with the container active so `inject()` works). Exposes `defineMacro`, `macro`, `MacroHooks`, and `MacroFactory`.

- 3d767aa: Add general method-level AOP — `@before` / `@after` / `@around` advice on any injectable method.

  - Advise _any_ container-managed service method (not just HTTP handlers) with cross-cutting logic — logging, caching, retry, timing, transactions. `@around` receives a `ProceedingJoinPoint` and calls `proceed()` (optionally with modified args); it can transform the result, short-circuit, or catch errors. `@before` runs first; `@after` runs last (awaiting async methods).
  - Multiple `@around` advice nest — the top-most decorator is outermost.
  - Implemented via a `Proxy` post-processor (`aspectProcessor`) that `createApp` auto-registers; advice applies to calls through the injected instance, and **self-invocation bypasses advice** (a call to another method on `this` is not advised). `#private` fields work through the proxy.
  - Exposes `before`, `after`, `around`, `aspectProcessor`, and the `JoinPoint` / `ProceedingJoinPoint` / advice types.

- 3d767aa: Add `@module` for composing controllers into prefixed, nestable units.

  - **`@module({ prefix, controllers, modules, use, derive, catchError })`** groups controllers under a shared path prefix and shares its cross-cutting concerns — guards (`use`), derivers (`derive`), and error handlers (`catchError`) — with every controller it mounts and with any nested `modules`.
  - Mount modules via **`createApp({ modules: [...] })`**; they can be combined with explicit `controllers`. Prefixes compose across nesting (`/admin` → `/admin/billing` → controller base → route).
  - Import cycles are broken automatically (recursion-stack guard), while a shared module can still be mounted under several parents (a diamond).
  - Exposes `module` and `ModuleOptions`.

- 3d767aa: Add OpenAPI 3.1 document generation.

  - **`app.openapi(options)`** builds an OpenAPI 3.1 document from the mounted routes: paths (with `:param` → `{param}`), methods, path/query parameters, request bodies, and responses.
  - Declare per-route metadata (`summary`, `description`, `tags`, `operationId`, `deprecated`) via a new `openapi` field on the route decorator options (`@get("/:id", { params, response, openapi: { summary } })`). `RouteOptions` is exposed for the combined schema + openapi shape.
  - Because Standard Schema doesn't mandate a JSON-Schema export, pass `options.toJsonSchema` to include schema bodies (TypeBox schemas already are JSON Schema; Zod via `zod-to-json-schema`). Without it, the document still lists every path, method, and parameter (path params default to `string`).
  - `options` also takes `info` and `servers`. Serve the document however you like (e.g. via an `onRequest` hook). Exposes `OpenApiOptions`, `OpenApiDocument`, `OpenApiInfo`, `OpenApiServer`, and `OperationMeta`.

- 3d767aa: Add OpenTelemetry tracing via the `turnover/otel` subpath — convention-first, one line to enable.

  - **`otel()` plugin** — `createApp({ plugins: [otel()] })` enables app-wide HTTP server tracing with zero config: a `SERVER` span per request named by the matched route (`GET /users/:id`, low-cardinality), W3C `traceparent` continuation, HTTP semantic-convention attributes, and exception/5xx recording. The server span is the **active** context, so nested spans attach to it automatically. Customize with `ignore` / `enrich` / `captureRequestHeaders`.
  - **`@traced()`** — trace child spans (built on the AOP seam). On a **method** it traces that method; on a **class** it traces every public method, with a per-method **`@noTrace`** opt-out. Configure the spans with `@traced({ name, kind, attributes, enrich })` — `enrich(span, joinPoint)` can add attributes from the call's arguments.
  - **`addAround(meta, method, advice)`** — the programmatic form of `@around` (apply advice to many methods at once); what class-level `@traced()` is built on.
  - The core stays **dependency-free**: `turnover/otel` is a separate entry, and `@opentelemetry/api` is an _optional_ peer dependency. With no OpenTelemetry SDK registered, every call is a no-op (zero overhead).

  New framework primitives it's built on (also useful on their own):

  - **`ctx.route`** — the matched route pattern (low-cardinality) on the handler `Context`, for telemetry span names, metric labels, and structured logging.
  - **`createApp({ wrap })` / `app.wrap()` / `Plugin.wrap`** — wrap every request outermost (around guards, the handler, and error handling), seeing the final `Response`. The place to establish per-request ambient context.

- 3d767aa: Add container post-processors — the instance-wrapping seam for method-level AOP.

  - **`Container.addPostProcessor((instance, token) => instance | wrapper)`** (or **`createApp({ postProcessors })`**) inspects each freshly constructed class instance and returns it, or a wrapper such as a `Proxy`.
  - Processors **chain** in registration order, and a returned wrapper is **cached** so later resolves get it. Registered before any construction.
  - The raw instance is cached first, so re-entrant resolution during construction doesn't loop and self-invocation reaches the unwrapped object.
  - This is the low-level seam that general method-level advice will be built on. Exposes `PostProcessor` and `Container.addPostProcessor`.

- 3d767aa: Add `@derive` for request-scoped context.

  - **`@derive(...derivers)`** (controller or route) runs before guards to compute per-request values. A deriver returns an object to merge into `ctx.store`, writes `ctx.store` directly, or throws (e.g. an `HttpError`) to abort.
  - **`ctx.store`** holds those values; augment the `RequestStore` interface to type it. Injected singletons can read the same store via **`getRequestStore()`** without a `ctx`.
  - Per-request ordering is now **derivers → guards → validation → handler**; class-level derivers run before method-level ones. The store is isolated per request via `AsyncLocalStorage`.
  - Exposes `derive`, `Deriver`, `RequestStore`, and `getRequestStore`.

- 3d767aa: Add a `"request"` DI scope.

  - **`@injectable({ scope: "request" })`** gives one instance per request, shared across every injection within that request and rebuilt for the next. It's injected as a proxy that resolves the current request's instance, so it works even when injected into a singleton. Backed by the `AsyncLocalStorage` request state.
  - App-level lifecycle tracking (awaiting async `@postConstruct` at bootstrap, running `@preDestroy` on shutdown) now applies **only to singletons** — transient/request beans are short-lived, so tracking them would leak. `@postConstruct` still runs on each transient/request instance.

- 3d767aa: Add response control and cookies to the request context.

  - **`ctx.set`** — set the status of a coerced return value (`ctx.set.status`) and merge headers onto the response (`ctx.set.headers`, a `Headers`). A returned `Response` keeps its own status; `set.headers` still merge onto it, preserving its existing headers.
  - **`ctx.cookies`** — read incoming cookies (`get` / `has` / `all`) and queue outgoing ones (`set(name, value, options)` / `delete(name, options?)`) with the usual attributes (`path`, `domain`, `expires`, `maxAge`, `httpOnly`, `secure`, `sameSite`, `partitioned`). Values are URL-encoded/decoded.
  - `set.headers` and cookies are applied to **every** response — coerced values, returned `Response`s, guard short-circuits, and error responses alike.
  - Exposes `Cookies`, `CookieOptions`, and `ResponseState`.

- 3d767aa: Add scheduled tasks (`@scheduled`) and stereotype aliases (`@service` / `@repository`).

  - **`@scheduled({ interval, runOnStart? })`** runs a service method on a fixed interval while the app is listening — started by `app.listen()`, cleared by `app.stop()`. `runOnStart` also runs it once at startup; a failing run is logged, not propagated. The service must be constructed (inject it, or list it in `createApp({ listeners })`). For cron expressions, layer an external cron library over the same methods. Exposes `scheduled`, `Scheduler`, `ScheduledOptions`, and `schedulingProcessor`.
  - **`@service()`** and **`@repository()`** are stereotype aliases of `@injectable()` (service-layer and persistence components).

- 3d767aa: Add Standard Schema validation for route inputs and responses.

  - Declare schemas on a route decorator's options — `@post("/", { body, query, params, response })` — using any [Standard Schema](https://standardschema.dev)-compatible validator (Zod, Valibot, ArkType, TypeBox with its adapter, …). turnover takes **no dependency** on a validator; it only speaks the interface.
  - Validated (and coerced) inputs are exposed on `ctx.valid.body` / `ctx.valid.query` / `ctx.valid.params`. `ctx.body()` still returns the raw body. Cast `ctx.valid.*` to the schema's output type (or use `InferOutput<typeof Schema>`) — standard decorators can't flow the type onto the handler signature.
  - A failed input validation throws a `422` with `{ error: { code: "validation_failed", details: { location, issues } } }`. A failed `response` validation is a server bug — logged and returned as an opaque `500`.
  - Validation runs after guards. Exposes `StandardSchemaV1`, `RouteSchemas`, `InferInput`/`InferOutput`, `validate`, `issuePath`, and the Standard Schema result/issue types.

- 3d767aa: Add pluggable body parsers and response serializers.

  - **`BodyParser`** — parse a request body by content type (exact, subtype wildcard, or catch-all). `ctx.body()` picks the first matching parser, falling back to the built-in JSON/text default.
  - **`ResponseSerializer`** — turn a non-`Response` return value into a `Response`, or return `undefined` to defer. Serializers get first crack before the JSON default, can content-negotiate via `ctx` (the `Accept` header), wrap values (envelopes), or stream (`ReadableStream`).
  - Register via `createApp({ parsers, serializers })`, `app.addParser()` / `app.addSerializer()`, or a `Plugin` (`parsers` / `serializers`). Exposes `BodyParser` and `ResponseSerializer`.

- 3d767aa: Add `App.handle(request)` for socket-free request handling, and make it the single routing path.

  - **New `app.handle(request)`** runs a `Request` through the full pipeline — routing, path-param capture, guards, DI, and response coercion — and returns a `Response` without opening a socket. Ideal for tests and offline tooling.
  - **Unified routing.** `listen()` now serves through `handle()`, so an in-memory call behaves identically to a live request. `listen(port)` still returns Bun's `Server` (`.stop()`, `.port`, `.url`); pass `0` for an OS-assigned port. Unknown paths return `404`; unsupported methods return `405` with an `Allow` header.
  - **`createApp({ controllers })` now mounts exactly the listed controllers** (isolated from anything else imported), instead of always mounting every `@controller` that has been registered globally.
  - String handler return values now carry an explicit `text/plain;charset=utf-8` content-type, so `handle()` results match what `listen()` serves.
  - Adds a `bun test` suite (`bun test`) covering routing, DI scopes, guards, request-scoped auth, and server lifecycle.

- 3d767aa: Add `@transactional` and `@cacheable` / `@cacheEvict` — declarative transactions and caching on the method-AOP mechanism.

  - **`@transactional`** runs a method inside the bound `TransactionManager` (commit on success, roll back on throw); the method's result becomes a `Promise`. Bind your database's manager via `{ provide: TRANSACTION_MANAGER, useValue }`; the default just runs the method.
  - **`@cacheable(options?)`** memoizes a method's result by its arguments (async results cached once resolved). Options: `key`, `ttl` (ms), and `keyBy(...args)`. **`@cacheEvict`** clears the cache when the method is called. Uses an in-memory `MemoryCache` by default; bind `CACHE_STORE` to swap it (e.g. Redis).
  - Both are container-bound post-processors `createApp` auto-registers; caching sits outside transactions (a cache hit skips the transaction). Exposes `transactional`, `TransactionManager`, `TRANSACTION_MANAGER`, `cacheable`, `cacheEvict`, `CacheStore`, `CACHE_STORE`, and `MemoryCache`.

- 3d767aa: Add a minimal typed HTTP client (`createClient`).

  - **`createClient<paths>(config)`** is a dependency-free typed client driven by an [`openapi-typescript`](https://github.com/openapi-ts/openapi-typescript)-generated `paths` type — the codegen-based end-to-end type safety, since standard decorators can't infer client types. Pipeline: dump `app.openapi()` → `openapi-typescript` → `createClient<paths>`.
  - Typed `get`/`post`/`put`/`patch`/`delete`: path params, query, and body are typed and checked; the response `data` is typed per route; a non-2xx populates `error` instead. Options are required only when a route has path params or a body.
  - `config.fetch` can override the fetch implementation — pass `app.handle` to drive an app in-memory. Exposes `createClient`, `Client`, `ClientConfig`, and `ClientResult`.

- 3d767aa: WinterTC / runtime interop — `app.fetch` and `app.delegate()`.

  The request pipeline is a standard WinterTC `(Request) => Promise<Response>` fetch handler. Two additions make Turnover deployable and composable across compliant runtimes:

  - **`app.fetch`** — the bound fetch handler for the app, so `export default app` (or `export default { fetch: app.fetch }`) deploys on Cloudflare Workers, Deno Deploy, Vercel, etc. `app.listen()` remains the Bun server; `app.fetch` is the runtime-agnostic entry. Also exports the `FetchHandler` type.
  - **`app.delegate(path, handler)`** — compose any other WinterTC-compliant handler (another Turnover app's `app.fetch`, or a raw function) at a path prefix. The prefix is stripped so the sub-app sees relative paths; the delegate owns its whole prefix; the longest matching prefix wins. Also available as `createApp({ delegate: { "/legacy": handler } })`.

### Patch Changes

- 3d767aa: Harden the toolchain — enforce the framework's own boundaries mechanically instead of by review.

  - **`noRestrictedImports`** now bans `reflect-metadata` everywhere (standard TC39 decorators only) and `@opentelemetry/*` outside `src/otel.ts` (optional peers stay behind their subpath). The zero-dependency and standard-decorator guarantees are checked in CI, not just documented.
  - **Stricter type-checking** — `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `noFallthroughCasesInSwitch`, and `noImplicitOverride` are on. Every indexed access in `src/` is now guarded (no non-null assertions), making the "possibly undefined" rule mechanical.
  - **A `tools/lint/` check runner** — `bun run lint` now also runs a check Biome and `tsc` can't express: numbered-doc integrity (`§N.M` citations stay resolvable). It is unit-tested and bound to the rule it enforces.

  No public API change.

## 0.1.0

### Minor Changes

- 55c246b: Initial public release of turnover — a decorator-first REST framework for Bun:
  `@controller` and HTTP-verb route decorators, a small dependency-injection
  container (`@injectable` / `inject`), `@use` guards, and request-scoped auth on
  top of `Bun.serve`.
