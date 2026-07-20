---
title: Public API
description: Every symbol exported from the turnover package, grouped by area, with the package's entry points.
sidebar:
  order: 1
---

This is the reference for the **public API** — the symbols the `turnover` package
exports and the entry points you import them from. Each core area links to the concept
or guide page that carries the worked examples; the reference itself stays a lookup.

Turnover ships a much larger production surface than the core concepts below —
authentication schemes, sessions, CSRF, rate limiting, metrics, jobs, and more. Those
live on their own page: [Production modules](/reference/production-modules/).

## Entry points

Everything you import day-to-day comes from the package root. A handful of extra entry
points are exposed as subpaths, so the core stays dependency-free.

| Specifier | What it is |
| --- | --- |
| `turnover` | The root barrel — bootstrap, routing, DI, config, validation, errors, and every symbol grouped below. |
| `turnover/otel` | OpenTelemetry integration (`otel`, `traced`, `noTrace`). Not re-exported from the root, so `@opentelemetry/api` stays optional. |
| `turnover/bundler` | Build-time bundler plugin (`turnoverPlugin`, `scanControllerFiles`) for bundling auto-discovered controllers. |
| `turnover/codegen` | Client codegen (`generateClient`) — turns an OpenAPI document into typed client source. |
| `turnover/redis` | Redis-backed store adapters (`redisSessionStore`, `redisCacheStore`, `redisOtpStore`, `redisJobStore`). |
| `turnover/testing` | In-memory test client (`testClient`) over `app.handle`. |
| `turnover/auth` | Augmentation target for the `Principal` interface (its runtime values are also in the root barrel). |
| `turnover/request` | Augmentation target for the `RequestStore` interface (its runtime values are also in the root barrel). |

```ts title="app.ts"
import { createApp, controller, get, inject } from "turnover";
```

:::note
The package is **ESM-only** and has **no default export** — you build an app with
`createApp()`, not `import app from "turnover"`. The `turnover/auth` and
`turnover/request` subpaths exist chiefly so you can
`declare module "turnover/auth" { interface Principal { … } }`; the same values are
re-exported from the root barrel.
:::

## Grouped exports

Every symbol below is imported from `"turnover"`.

### App & bootstrap

| Export | Kind | Purpose |
| --- | --- | --- |
| `createApp` | function | Build the container, register plugins, discover and mount controllers, return a ready `App` (async). |
| `App` | class | The application: `listen()`, `handle(req)`, `fetch`, `stop()`, `docs()`, plus hook registration. |
| `CreateAppOptions` | interface | Options for `createApp` — `controllers`, `modules`, `providers`, `plugins`, hooks, `config`. |
| `ListenOptions` | interface | Options for `App.listen` (e.g. `signals` to control graceful-shutdown handlers). |
| `DocsOptions` | interface | Options for `App.docs` (serves `/openapi.json` and a Scalar docs UI). |
| `Plugin` | interface | A reusable bundle of hooks, parsers, and serializers registered via `app.register`. |
| `FetchHandler` | type | `(req: Request) => Promise<Response>` — the type of `App.fetch`. |
| `BodyParser` | interface | A content-type-matched request-body parser. |
| `ResponseSerializer` | interface | A content-negotiated response serializer. |
| `RequestHook`, `ResponseHook`, `AfterResponseHook`, `StartHook`, `StopHook` | types | Signatures for the `onRequest` / `onResponse` / `onAfterResponse` / `onStart` / `onStop` hooks. |
| `TraceHook`, `TraceEvent` | type, interface | Per-request timing hook and its event payload. |

Beyond the constructor, an `App` also exposes `register`, `wrap`, `delegate`,
`websocket`, `openapi`, `docs`, and `routeTable` methods — these are members of the
`App` class, not separate exports.

See [The request lifecycle](/concepts/the-request-lifecycle/) and
[Lifecycle hooks & plugins](/concepts/lifecycle-hooks-and-plugins/).

### Routing & HTTP

| Export | Kind | Purpose |
| --- | --- | --- |
| `controller` | decorator | Mark a class as a controller and set its base path. |
| `get`, `post`, `put`, `patch`, `del` | decorators | Bind a method to an HTTP verb and path, with optional route schemas and OpenAPI metadata. |
| `use` | decorator | Attach one or more guards to a controller or route. |
| `intercept` | decorator | Wrap the handler with around-advice interceptors. |
| `catchError` | decorator | Attach error handlers to a controller or route. |
| `Context` | interface | The per-request handler argument: `req`, `params`, `query`, `body()`, `valid`, `set`, `cookies`, `store`. |
| `Guard` | type | `(ctx) => Response \| void \| Promise<…>` — return or throw a `Response` to short-circuit. |
| `Interceptor` | type | Around-advice: `(ctx, next) => Response`. |
| `ErrorHandler` | type | `(err, ctx) => Response \| undefined` — handle or defer to the next handler. |
| `RouteOptions` | interface | Per-route `body` / `query` / `params` / `response` schemas plus `openapi` metadata. |

See [Controllers & routing](/concepts/controllers-and-routing/) and
[Interceptors](/concepts/interceptors/).

### Dependency injection

| Export | Kind | Purpose |
| --- | --- | --- |
| `injectable` | decorator | Register a class in the container (default `singleton` scope). |
| `service` | decorator | Alias of `injectable` — a stereotype for services. |
| `repository` | decorator | `injectable` plus `@transactional` on every method — a DAO stereotype. |
| `inject` | function | Resolve a dependency in a field initializer. |
| `injectAll` | function | Resolve every binding of a token (multi-inject). |
| `injectOptional` | function | Resolve a token, or fall back to a default when it is unbound. |
| `postConstruct` | decorator | Async init hook, awaited at bootstrap. |
| `preDestroy` | decorator | Teardown hook, run in reverse order on `app.stop()`. |
| `Container` | class | The DI container: `register`, `resolve`, `resolveAll`, `addPostProcessor`. |
| `InjectionToken` | class | A typed token for non-class dependencies. |
| `Token`, `Provider`, `ProviderDef`, `PostProcessor` | types | Token, provider, and post-processor shapes. |
| `Scope` | type | `'singleton' \| 'transient' \| 'request'`. |

See [Dependency injection](/concepts/dependency-injection/).

### Configuration & profiles

| Export | Kind | Purpose |
| --- | --- | --- |
| `Config` | class | Injectable typed reader over the active `ConfigSource`. |
| `value` | function | Read a config value with type coercion. |
| `requireValue` | function | Read a required config value (throws when absent). |
| `profile` | decorator | Gate a controller or module on the active profiles. |
| `configProperties` | decorator | Bind and validate a class's fields from the environment via a Standard Schema (fail-fast at construction). |
| `ConfigSource` | interface | A pluggable source of config values. |
| `EnvConfigSource` | class | The default `ConfigSource`, backed by `Bun.env`. |
| `CONFIG_SOURCE` | token | Bind a custom `ConfigSource`. |
| `ACTIVE_PROFILES` | token | The active profile names. |
| `ConfigPropertiesOptions` | interface | Options for `configProperties` (e.g. a key `prefix`). |
| `ConfigValidationError` | class | Thrown when `configProperties` validation fails. |

See [Configuration](/concepts/configuration/).

### Errors

| Export | Kind | Purpose |
| --- | --- | --- |
| `HttpError` | class | Base HTTP error carrying a status, message, and optional `code` / `details` / `cause`. |
| `BadRequestError` … `InternalServerError` | classes | Fixed-status subclasses: `BadRequestError` (400), `UnauthorizedError` (401), `PaymentRequiredError` (402), `ForbiddenError` (403), `NotFoundError` (404), `ConflictError` (409), `GoneError` (410), `UnprocessableEntityError` (422), `TooManyRequestsError` (429), `InternalServerError` (500). |
| `catchError` | decorator | Attach error handlers to a controller or route. |
| `toErrorResponse` | function | Render an error to the default JSON envelope. |
| `HttpErrorOptions`, `ErrorBody` | interfaces | Options for `HttpError` and the JSON error-body shape. |

There is **no fixed error-code enum** — `code` is an optional free-form string. The only
framework-emitted code is `"validation_failed"` (422 input validation).

See [Error handling](/concepts/error-handling/).

### Validation & schema

| Export | Kind | Purpose |
| --- | --- | --- |
| `validate` | function | Run a Standard Schema against a value (async). |
| `issuePath` | function | Format a validation issue's path. |
| `StandardSchemaV1` | interface | The Standard Schema v1 contract — any conformant validator (Zod, Valibot, ArkType, TypeBox). |
| `RouteSchemas` | interface | The `body` / `query` / `params` / `response` schema set on a route. |
| `InferInput`, `InferOutput` | types | Extract a schema's input / output type. |
| `ValidatedInputs` | interface | The shape of `ctx.valid`. |
| `StandardResult`, `StandardSuccess`, `StandardFailure`, `StandardIssue` | types | Standard Schema result shapes. |

See [Validation](/concepts/validation/).

### Auth & guards

| Export | Kind | Purpose |
| --- | --- | --- |
| `Auth` | class | Request-scoped accessor for the current principal (`inject(Auth)`). |
| `Principal` | interface | The authenticated-user shape — augment it via `turnover/auth`. |
| `requireAuth` | value (Guard) | Guard requiring an authenticated principal (401 otherwise). |
| `authenticated` | decorator | `@use(requireAuth)` expressed as a decorator. |
| `requireRole` | decorator | Require the principal to hold one of the given roles (403 otherwise). |
| `requireScope` | decorator | Require the principal to hold one of the given scopes (403 otherwise). |
| `authorize` | decorator | Build a guard from a custom `(principal, ctx) => boolean` policy. |

The credential **schemes** that populate the principal (`authentication`, `bearer`,
`apiKey`) live in [Production modules](/reference/production-modules/).

See [Guards & auth](/concepts/guards-and-auth/).

### Request scope & context

| Export | Kind | Purpose |
| --- | --- | --- |
| `derive` | decorator | Compute per-request values into `ctx.store` before guards run. |
| `resolve` | decorator | Compute per-request values after validation (can read `ctx.valid`). |
| `Deriver` | type | `(ctx) => object \| Promise<object>` merged into `ctx.store`. |
| `getRequestState` | function | Read the current request's state (principal, store, id). |
| `getRequestStore` | function | Read the typed per-request store. |
| `setPrincipal` | function | Attach a principal to the current request. |
| `getRequestId`, `setRequestId` | functions | Read / set the request correlation id. |
| `RequestState` | interface | The per-request state bag. |
| `RequestStore` | interface | The typed store — augment it via `turnover/request`. |

See [Deriving context](/concepts/deriving-context/).

### Method advice (AOP)

| Export | Kind | Purpose |
| --- | --- | --- |
| `before`, `after`, `around` | decorators | Advise an injectable method — run before, after, or around it. |
| `JoinPoint`, `ProceedingJoinPoint` | interfaces | The advised call's target and args (and `proceed` for around-advice). |
| `BeforeAdvice`, `AfterAdvice`, `AroundAdvice` | types | Advice-function signatures. |

See [Method advice](/concepts/method-advice/).

### Transactions

| Export | Kind | Purpose |
| --- | --- | --- |
| `transactional` | decorator | Run a method inside the bound `TransactionManager`. |
| `TransactionManager` | interface | The pluggable unit-of-work contract. |
| `TRANSACTION_MANAGER` | token | Bind a `TransactionManager` implementation. |

Built on the same post-processor seam as method advice — see
[Method advice](/concepts/method-advice/).

### Caching

| Export | Kind | Purpose |
| --- | --- | --- |
| `cacheable` | decorator | Memoize a method's result in a `CacheStore`. |
| `cacheEvict` | decorator | Clear cached entries. |
| `CacheStore` | interface | The pluggable cache backend. |
| `CACHE_STORE` | token | Bind a custom `CacheStore`. |
| `MemoryCache` | class | The default in-memory `CacheStore`. |
| `CacheableOptions` | interface | Options for `cacheable` (`key`, `ttl`, `keyBy`). |

Built on the same post-processor seam as method advice — see
[Method advice](/concepts/method-advice/).

### Cookies & response

| Export | Kind | Purpose |
| --- | --- | --- |
| `Cookies` | class | The `ctx.cookies` jar: `get` / `set` / `delete`, serialized onto the response. |
| `CookieOptions` | interface | Cookie attributes (`httpOnly`, `sameSite`, `path`, …). |
| `ResponseState` | interface | The shape of `ctx.set` (status, headers). |

See [Responses & cookies](/concepts/responses-and-cookies/).

### Modules

| Export | Kind | Purpose |
| --- | --- | --- |
| `module` | decorator | Group controllers under a prefix with shared cross-cutting; nestable. |
| `ModuleOptions` | interface | Module configuration: `prefix`, `controllers`, nested `modules`, and shared `use` / `derive` / `intercept` / `catchError`. |

See [Modules](/concepts/modules/).

### Macros

| Export | Kind | Purpose |
| --- | --- | --- |
| `defineMacro` | function | Register a named, parameterized, DI-resolvable cross-cutting bundle. |
| `macro` | decorator | Apply a registered macro to a class or method. |
| `MacroHooks`, `MacroFactory` | interface, type | The hooks a macro can contribute and its factory shape. |

See [Macros](/concepts/macros/).

### Events

| Export | Kind | Purpose |
| --- | --- | --- |
| `Events` | class | Injectable in-process publish/subscribe bus. |
| `onEvent` | decorator | Subscribe a method to an event type (on construction). |
| `EventType`, `EventListener` | types | The event-type and listener shapes. |

See [Events](/concepts/events/).

### Scheduling

| Export | Kind | Purpose |
| --- | --- | --- |
| `scheduled` | decorator | Run a method on a fixed interval. |
| `Scheduler` | class | The interval runner (started by `listen()`). |
| `schedulingProcessor` | function | Post-processor that wires `@scheduled` methods. |
| `ScheduledOptions` | interface | `{ interval, runOnStart? }`. |

See [Scheduled tasks](/concepts/scheduled-tasks/).

### CORS

| Export | Kind | Purpose |
| --- | --- | --- |
| `cors` | plugin | Preflight handling plus CORS response headers. |
| `CorsOptions` | interface | `origin`, `methods`, `allowedHeaders` / `exposedHeaders`, `credentials`, and `maxAge`. |

See [CORS](/guides/cors/).

### OpenAPI

| Export | Kind | Purpose |
| --- | --- | --- |
| `OpenApiDocument`, `OpenApiInfo`, `OpenApiOptions`, `OpenApiServer`, `OperationMeta` | interfaces | The OpenAPI 3.1 document shapes. |

The document is built by `app.openapi(options?)` and served — with a Scalar UI — by
`app.docs()`. See [OpenAPI](/guides/openapi/).

### Typed client

| Export | Kind | Purpose |
| --- | --- | --- |
| `createClient` | function | Build a typed HTTP client from an `openapi-typescript` `paths` type. |
| `Client`, `ClientConfig`, `ClientResult` | interfaces | The client instance, its config, and a per-call result shape. |

See [Typed client](/guides/typed-client/).

### Metadata & extension seam

| Export | Kind | Purpose |
| --- | --- | --- |
| `decoratorMeta` | function | Read / write the shared metadata bag for a decorator context. |
| `classMeta` | function | Read a class's accumulated metadata. |
| `addAround` | function | Add around-advice programmatically — the primitive behind custom advice decorators. |
| `aspectProcessor` | value (PostProcessor) | The post-processor that applies method advice. |
| `MetaBag`, `Ctor`, `HttpMethod` | types | The metadata bag and shared type aliases. |

These are the building blocks the framework uses for its own decorators (and how
`turnover/otel`'s `@traced` is built). See [Method advice](/concepts/method-advice/).

## Beyond the core

The barrel exports roughly two to three times the surface shown above — production
feature modules for auth schemes, sessions, CSRF, security headers, rate limiting,
compression, ETags, request ids, static files, multipart, SSE, WebSocket, pagination,
health checks, problem-details, structured logging, Prometheus metrics, background jobs,
mailing, OAuth2, password/OTP/TOTP, and Redis store adapters. They are mapped on
[Production modules](/reference/production-modules/). The concept pages linked above
carry the worked, runnable examples for each core area.

## Next steps

- [Production modules](/reference/production-modules/)
- [Controllers & routing](/concepts/controllers-and-routing/)
- [Dependency injection](/concepts/dependency-injection/)
- [Quickstart](/getting-started/quickstart/)
</content>
</invoke>
