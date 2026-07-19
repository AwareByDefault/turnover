# turnover

**Decorator-first REST framework for Bun** — inject your dependencies, mount
controllers, and let them rest.

A small, Bun-native REST framework built on **standard TC39 decorators** — no
`experimentalDecorators`, no `emitDecoratorMetadata`, no Reflect-metadata. It
gives you `@controller` / `@get` routing, a tiny dependency-injection container,
and request-scoped auth on top of `Bun.serve`.

## Install

```bash
bun add turnover
```

## Quick start

Define a controller, then let `createApp()` **discover** it — no manual imports,
no registration list:

```ts
// hello.controller.ts
import { controller, get } from "turnover";

@controller("/hello")
export class HelloController {
  @get("/")
  hello() {
    return { message: "Hello from turnover" };
  }
}
```

```ts
// server.ts
import { createApp } from "turnover";

const app = await createApp(); // discovers every @controller under this directory
const server = app.listen(3000);

console.log(`🚀 Server running at ${server.url}`);
```

```bash
bun server.ts   # → GET http://localhost:3000/hello
```

`createApp()` with no arguments walks the entry file's directory, imports every
`@controller`, and mounts it. Prefer to wire things up by hand? Pass a
`controllers` list instead — see
[Auto-discovery & manual registration](#auto-discovery--manual-registration).

> Requires [Bun](https://bun.sh) — the framework calls `Bun.serve`, `Bun.Glob`,
> `Bun.main`, and `Bun.file` directly. Works under the default `tsconfig.json`;
> no decorator-related compiler flags are needed.

## Auto-discovery & manual registration

**Auto-discovery is the default.** `createApp()` — called with no `controllers`
and no `modules` — scans the entry file's directory tree (`**/*.ts` via
`Bun.Glob`), imports any file whose source contains `@controller(`, and each one
self-registers as its module loads. No barrel of imports to maintain:

```ts
const app = await createApp();                 // scan the entry file's directory
const app = await createApp({ dir: "./src" }); // ...or point the scan elsewhere
```

**Manual registration** is the alternative — pass `controllers` and/or `modules`
to mount **exactly those**, skipping the filesystem scan. Reach for it when a
glob scan won't work (bundled/compiled builds), in tests, or any time you want
explicit, order-controlled wiring:

```ts
import { createApp } from "turnover";
import { UsersController } from "./users.controller";
import { AdminModule } from "./admin.module";

const app = await createApp({
  controllers: [UsersController],
  modules: [AdminModule],
});
```

Explicitly listed controllers mount **isolated** from the global discovery
registry, so a test mounts only what it names. The feature examples below pass
`controllers: [...]` for self-containedness — in a real app you can usually drop
that and let discovery do the wiring.

> **Bundling.** Auto-discovery relies on a runtime filesystem scan, which a
> bundler tree-shakes away — so a naively bundled `createApp()` app boots with
> **zero routes**. Two ways to fix it:
>
> - **`turnoverPlugin()`** (from `turnover/bundler`) — keep auto-discovery: the
>   plugin runs the same scan at **build** time and bundles the `@controller`
>   files in, so your entry keeps calling `createApp()` unchanged.
>
>   ```ts
>   import { turnoverPlugin } from "turnover/bundler";
>   await Bun.build({ entrypoints: ["./src/server.ts"], outdir: "dist",
>                     target: "bun", plugins: [turnoverPlugin()] });
>   ```
>
> - **Register controllers explicitly** (`createApp({ controllers: [...] })`) —
>   always bundles cleanly and starts faster as the app grows.
>
> `test/bundle-smoke.test.ts` proves all three paths by actually `bun build`-ing
> and cURLing each.

## Concepts

Everything below is imported from the `turnover` package. The sections build up
from routing and DI to the cross-cutting machinery — guards, validation,
interceptors, method AOP, events, and more.

### Controllers & routes

Decorate a class with `@controller("/base")` and its methods with an HTTP-verb
decorator. Each handler receives a `Context` and returns a value that is coerced
into a `Response`.

```ts
import { type Context, controller, del, get, inject, post } from "turnover";
import { GreetingService } from "./greeting.service";

@controller("/users")
export class UsersController {
  private readonly greeter = inject(GreetingService);
  private readonly users = new Map<string, User>();

  @get("/")
  list() {
    return { users: [...this.users.values()] }; // object → JSON
  }

  @get("/:id")
  getOne(ctx: Context<{ id: string }>) {
    const user = this.users.get(ctx.params.id);
    if (!user) return new Response(`No user "${ctx.params.id}"`, { status: 404 });
    return { user };
  }

  @post("/")
  async create(ctx: Context) {
    const user = await ctx.body<User>();
    this.users.set(user.id, user);
    return Response.json({ created: user }, { status: 201 });
  }

  @del("/:id")
  remove(ctx: Context<{ id: string }>) {
    return { deleted: this.users.delete(ctx.params.id) };
  }
}
```

Route decorators: `@get`, `@post`, `@put`, `@patch`, `@del` (named `del` because
`delete` is reserved). Paths are joined with the controller base and normalized
(duplicate and trailing slashes collapsed).

**The `Context` object:**

| Field          | Type                         | Description                                        |
| -------------- | ---------------------------- | -------------------------------------------------- |
| `ctx.req`      | `Request`                    | The raw Web `Request`.                             |
| `ctx.route`    | `string`                     | The matched pattern (e.g. `/users/:id`) — low-cardinality, for telemetry/logging. |
| `ctx.params`   | `Record<string, string>`     | Path params from the pattern (e.g. `/:id`).        |
| `ctx.query`    | `URLSearchParams`            | Parsed query string.                               |
| `ctx.body<T>()`| `() => Promise<T>`           | Lazily reads + parses the body (JSON by content-type). |

**Return-value coercion** (in [app.ts](src/app.ts)):

- `Response` → passed through unchanged
- `string` → `text/plain`
- `null` / `undefined` → `204 No Content`
- any other object → JSON

### Dependency injection

Mark a class `@injectable()` and pull it in with `inject(Token)` in a field
initializer — no constructor, no parameter decorators (standard decorators don't
have them). The container sets an ambient reference while constructing, which is
what lets `inject()` resolve.

```ts
import { injectable } from "turnover";

@injectable() // default scope: "singleton"
export class GreetingService {
  private count = 0;
  greet(name: string) {
    return `Hello, ${name}! (greeting #${(this.count += 1)})`;
  }
}
```

```ts
@controller("/users")
export class UsersController {
  private readonly greeter = inject(GreetingService); // resolved at construction
}
```

Scopes via `@injectable({ scope })`: `"singleton"` (default, cached and shared),
`"transient"` (new instance per resolve), or `"request"` (one instance per
request). A request-scoped bean is injected as a proxy that resolves the current
request's instance, so it works even inside a singleton. Controllers are
instantiated through the same container, so they can inject services. Circular
dependencies are detected and throw with a helpful message.

> `inject()` only works while the container is constructing an
> `@injectable` / `@controller`. Calling it at module top level throws.

**Providers.** Beyond auto-constructing concrete classes, you can bind a **token**
to a value, class, factory, or alias — the way to inject interfaces, config,
third-party objects, or mocks. Non-class dependencies use an `InjectionToken`:

```ts
import { InjectionToken, createApp } from "turnover";

interface Logger { info(msg: string): void }
const LOGGER = new InjectionToken<Logger>("Logger");

const app = await createApp({
  controllers: [...],
  providers: [
    { provide: LOGGER, useValue: console },              // a value / mock
    { provide: Database, useClass: PostgresDatabase },   // bind an interface to an impl
    { provide: CACHE, useFactory: (c) => new Cache(c.resolve(CONFIG)) }, // built with deps
    { provide: STORE, useExisting: CACHE },              // alias → same instance
  ],
});
```

Then `inject(LOGGER)` in any controller/service. `useClass`/`useFactory` take an
optional `scope` (`"singleton"` default, or `"transient"`). Registering a token
twice **overrides** it for `resolve()` (handy for test mocks) while
`resolveAll(token)` / `injectAll(token)` return **every** binding (multi-inject).
Register imperatively too via `app.container.register(token, provider)`.
`@service()` and `@repository()` are stereotype aliases of `@injectable()`.

**Lifecycle callbacks.** `@postConstruct` runs a method right after a service is
constructed (async ones are awaited during `createApp`, so the service is ready
before you serve); `@preDestroy` runs on `app.stop()`, in reverse construction
order. Use them to manage resources:

```ts
@injectable()
class Db {
  private pool!: Pool;
  @postConstruct async connect() { this.pool = await createPool(); }
  @preDestroy    async close()   { await this.pool.end(); }
}
```

**Configuration.** Read config with the `value()` helper (coerced to the
fallback's type) or by injecting `Config`. It reads `Bun.env` by default;
override with `createApp({ config })` (a plain object or a `ConfigSource`):

```ts
class Server {
  private port = value("PORT", 3000);     // number, from env or config
  private debug = value("DEBUG", false);  // boolean
}
const app = await createApp({ controllers: [...], config: { PORT: "8080" } });
// inject(Config).get(key, fallback) / .require(key) / .has(key) too
```

**Profiles.** Set active profiles with `createApp({ profiles: ["dev"] })` (or
`TURNOVER_PROFILES` / `NODE_ENV`). `@profile("dev")` mounts a controller or
module only when one of its profiles is active; `Config.hasProfile(name)` reads
them.

```ts
@profile("dev") @controller("/debug")
class DebugController { /* mounted only when "dev" is active */ }
```

**Post-processors (the AOP seam).** `container.addPostProcessor((instance, token)
=> …)` (or `createApp({ postProcessors })`) inspects each freshly constructed
instance and returns it — or a wrapper (e.g. a `Proxy`). Processors chain, and
the wrapper is cached. This is the low-level hook that method-level advice is
built on; self-invocation reaches the unwrapped object.

**Method advice (`@before` / `@after` / `@around`).** Wrap *any* injectable
service method — not just HTTP handlers — with cross-cutting logic (logging,
caching, retry, timing). `@around` receives a join point and calls `proceed()`:

```ts
@injectable()
class Orders {
  @before((jp) => console.log(`→ ${jp.method}`, jp.args))
  @around((jp) => { const t = performance.now(); const r = jp.proceed();
                    console.log(`${jp.method} took ${performance.now() - t}ms`); return r; })
  place(order: Order) { /* ... */ }
}
```

`@before` runs first, `@around` wraps the call (top-most is outermost, and may
transform args/result, short-circuit, or catch), `@after` runs last (awaiting
async methods). Advice applies to calls made through the injected instance;
self-invocation bypasses it (a call to another method on `this` is not advised).
`createApp` auto-registers the aspect processor.

**Transactions & caching** are two built-in advices on that mechanism:

```ts
@injectable()
class Orders {
  @transactional                       // runs inside the bound TransactionManager
  async place(order: Order) { /* ... commits, or rolls back on throw */ }

  @cacheable({ ttl: 60_000 })          // memoize by args in the CacheStore
  async pricing(sku: string) { /* ... */ }

  @cacheEvict                          // clear the cache when called
  async refresh() { /* ... */ }
}
```

Bind your database's manager (`{ provide: TRANSACTION_MANAGER, useValue }`) — the
default just runs the method. Caching uses an in-memory `MemoryCache` by default;
bind `CACHE_STORE` to swap it (e.g. Redis). `@cacheable` supports `key`, `ttl`,
and a `keyBy(...args)`.

### Guards & auth

`@use(...guards)` attaches middleware to a whole controller or a single route. A
guard returns nothing to continue, or returns/throws a `Response` to
short-circuit (e.g. a 401/403).

```ts
import { Auth, controller, get, inject, use } from "turnover";
import { authenticate, requireRole } from "./auth";

@controller("/me")
@use(authenticate) // runs before every route in this controller
export class MeController {
  private readonly auth = inject(Auth);

  @get("/")
  whoami() {
    return this.auth.user; // typed as your app's Principal
  }

  @get("/admin")
  @use(requireRole("admin")) // stacks on top of the controller guard
  adminOnly() {
    return { secret: `Hello admin ${this.auth.user.name}` };
  }
}
```

Request-scoped state lives in an `AsyncLocalStorage`, so `Auth` can be a plain
singleton whose getters read the *current* request's principal at call time —
injecting it into a singleton controller still yields per-request data.

- `Auth.user` — the principal, or throws `401` if unauthenticated
- `Auth.optional` — the principal or `null`
- `Auth.isAuthenticated` — boolean
- `requireAuth` — a ready-made guard that 401s when no principal is set

A guard authenticates by calling `setPrincipal(...)`. Type your user by
augmenting the framework's empty `Principal` interface (see
[example/auth.ts](example/auth.ts)):

```ts
declare module "turnover/auth" {
  interface Principal {
    id: string;
    name: string;
    roles: string[];
  }
}

export const authenticate: Guard = (ctx) => {
  const token = ctx.req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const user = token ? USERS[token] : undefined;
  if (!user) return new Response("Unauthorized", { status: 401 });
  setPrincipal(user); // now Auth.user resolves to this for the rest of the request
};
```

### Deriving request context

`@derive(...)` runs functions **before guards** to compute per-request values,
which land on `ctx.store` (and are readable from injected singletons via
`getRequestStore()`). Return an object to merge into the store, or write
`ctx.store` directly; throw to abort. Type the store by augmenting `RequestStore`.

```ts
import { controller, derive, get, use, type Context } from "turnover";

declare module "turnover/request" {
  interface RequestStore { tenant: string }
}

@controller("/orders")
@derive((ctx) => ({ tenant: ctx.req.headers.get("x-tenant") ?? "public" }))
@use(requireTenant) // guards run after derivers, so they can read ctx.store
export class OrdersController {
  @get("/")
  list(ctx: Context) {
    return { tenant: ctx.store.tenant };
  }
}
```

Order per request: **derivers → guards → validation → resolvers → handler**.
Class-level derivers run before method-level ones. `@resolve(...)` is like
`@derive` but runs **after validation**, so it can read `ctx.valid` (e.g. load
the entity named by a now-validated `:id`).

### Response control & cookies

Return a value and let it be coerced, or shape the response through `ctx.set` and
`ctx.cookies` without constructing a `Response` by hand.

```ts
@controller("/session")
export class SessionController {
  @post("/login")
  login(ctx: Context) {
    ctx.set.status = 201;                       // status for the coerced body
    ctx.set.headers.set("cache-control", "no-store");
    ctx.cookies.set("session", token, {         // queued as Set-Cookie
      httpOnly: true, secure: true, sameSite: "lax", maxAge: 3600,
    });
    return { ok: true };
  }

  @get("/me")
  me(ctx: Context) {
    const sid = ctx.cookies.get("session");     // read an incoming cookie
    return { sid };
  }

  @post("/logout")
  logout(ctx: Context) {
    ctx.cookies.delete("session");              // expire it
    return null;                                 // 204, still carries Set-Cookie
  }
}
```

- `ctx.set.status` sets the status of a **coerced** return value (a returned
  `Response` keeps its own status).
- `ctx.set.headers` (a `Headers`) is merged onto the response — even a returned
  `Response`, keeping that response's own headers.
- `ctx.cookies` reads incoming cookies (`get` / `has` / `all`) and queues
  outgoing ones (`set` / `delete`); values are URL-encoded. `set.headers` and
  cookies apply to **every** response, including a guard's short-circuit.

### Custom parsing & serialization

By default the body is parsed as JSON (or raw text) and return values are coerced
(object → JSON, string → text, `Response` passthrough). Register **parsers** and
**serializers** to change that.

```ts
const csv: BodyParser = {
  contentTypes: ["text/csv"],           // exact, `text/*`, or catch-all
  parse: async (req) => (await req.text()).split(","),
};
const envelope: ResponseSerializer = {
  // return a Response to handle, or undefined to defer to the next / the default
  serialize: (value) =>
    value && typeof value === "object" ? Response.json({ data: value }) : undefined,
};

const app = await createApp({ controllers: [...], parsers: [csv], serializers: [envelope] });
```

Parsers are chosen by the request's content type (`ctx.body()` uses them);
serializers get first crack at a non-`Response` return value and can
content-negotiate (via `ctx`), wrap, or stream (`ReadableStream`). Both can also
be added by a plugin.

### Validation

Declare [Standard Schema](https://standardschema.dev)-compatible schemas
(Zod, Valibot, ArkType, TypeBox with its adapter, …) on a route to validate its
`body`, `query`, `params`, and `response`. turnover takes **no dependency** on any
validator — it only speaks the Standard Schema interface.

```ts
import { z } from "zod";
import { controller, post, type Context } from "turnover";

const CreateUser = z.object({ name: z.string(), age: z.coerce.number() });

@controller("/users")
export class UsersController {
  @post("/", { body: CreateUser })
  create(ctx: Context) {
    const user = ctx.valid.body as z.infer<typeof CreateUser>;
    return { created: user }; // age has been coerced to a number
  }
}
```

Validated (and coerced) values land on `ctx.valid.body` / `ctx.valid.query` /
`ctx.valid.params`. Because standard decorators can't flow the schema's type onto
the handler signature, cast `ctx.valid.*` to the schema's output type (or use
`InferOutput<typeof Schema>`). `ctx.body()` still returns the *raw* body.

- A failed input validation throws a **`422`** whose body pinpoints the failure:
  `{ error: { code: "validation_failed", details: { location, issues } } }`.
- A failed **`response`** validation is treated as a server bug — logged, returned
  as an opaque `500`.
- Validation runs **after guards** (so auth rejects before input is inspected).

### Error handling

Throw an `HttpError` (or a named subclass) from a handler or guard and the
framework renders it as a JSON envelope with the right status. Anything that
isn't an `HttpError` becomes an opaque `500` (its message is never leaked to the
client) and is logged.

```ts
import { controller, get, NotFoundError, HttpError } from "turnover";

@controller("/users")
export class UsersController {
  @get("/:id")
  getOne(ctx: Context<{ id: string }>) {
    const user = this.users.get(ctx.params.id);
    if (!user) throw new NotFoundError(`No user "${ctx.params.id}"`);
    // → 404  { "error": { "message": "No user \"…\"" } }
    return { user };
  }
}

// custom status / code / details:
throw new HttpError(402, "Trial expired", { code: "trial_expired" });
```

Named subclasses: `BadRequestError` (400), `UnauthorizedError` (401),
`PaymentRequiredError` (402), `ForbiddenError` (403), `NotFoundError` (404),
`ConflictError` (409), `GoneError` (410), `UnprocessableEntityError` (422),
`TooManyRequestsError` (429), `InternalServerError` (500). Extend `HttpError` for
your own domain errors.

**Custom error handlers** map thrown values to responses. An `ErrorHandler`
returns a `Response` to handle the error, or nothing to defer to the next handler
in the chain — **route → controller → global → framework default**:

```ts
import { catchError, createApp, type ErrorHandler } from "turnover";

const onError: ErrorHandler = (err) => {
  if (err instanceof MyDomainError) return Response.json({ oops: err.message }, { status: 400 });
  // return nothing → fall through to the default renderer
};

// global:
const app = await createApp({ controllers: [...], onError });
app.onError(anotherHandler); // or register later

// controller- or route-scoped:
@controller("/orders")
@catchError(onError)
class OrdersController {
  @get("/:id") @catchError(routeSpecificHandler) getOne() { ... }
}
```

### Interceptors (around advice)

`@intercept(...)` wraps a handler — run code **before and after** in one place,
transform the response, short-circuit, or catch errors. An interceptor gets
`ctx` and a `next()` that runs the rest of the chain and returns its `Response`.

```ts
const timing: Interceptor = async (ctx, next) => {
  const started = performance.now();
  const res = await next();                    // run the handler
  res.headers.set("x-response-time", `${performance.now() - started}ms`);
  return res;                                   // transformed response
};

@controller("/things")
@intercept(timing)                              // wraps every route
class ThingsController {
  @get("/") @intercept(cacheFor(60)) list() { ... } // stacks; controller is outer
}
```

Interceptors nest: controller-level wraps method-level (and a module's wrap
both). They run **after guards**, around validation + the handler.

### Lifecycle hooks

- `onRequest(req)` runs **before routing** on every request (CORS, logging);
  return a `Response` to short-circuit.
- `onResponse(res, req)` runs after every response (including 404s and errors);
  return a `Response` to replace it, or mutate its headers.
- `onAfterResponse(res, req)` runs **fire-and-forget** after the response (never
  delays it) — for metrics/logging. `onTrace(event)` reports each request's
  `durationMs`.
- `onStart(server)` runs once after `listen()`; `onStop()` runs on `app.stop()`
  (which then closes the server).

A **plugin** is just a bundle of these hooks (`{ onRequest?, onResponse?, ... }`);
register one with `app.register(plugin)` or `createApp({ plugins: [...] })`.

```ts
const app = await createApp({
  controllers: [...],
  onRequest: [(req) => { /* ... */ }],
  onStart: [(server) => console.log(`up on ${server.url}`)],
  onStop: [() => db.close()],
});
const server = app.listen(3000);
// ... later: await app.stop();
```

Full per-request order: **onRequest → derivers → guards → interceptors (before)
→ validation → resolvers → handler → interceptors (after) → onResponse → response
→ onAfterResponse / onTrace**.

**`wrap`.** To run code *around the whole request* — outermost, wrapping guards,
the handler, **and** error handling, and seeing the final `Response` — register
a wrapper via `createApp({ wrap })`, `app.wrap(...)`, or a plugin's `wrap`. Unlike
`@intercept` (which wraps only the handler, after guards), `wrap` is the place to
establish per-request ambient context. It's what the OpenTelemetry plugin uses.

### OpenTelemetry

`otel()` (from the `turnover/otel` subpath) enables app-wide tracing in **one
line** — convention over configuration:

```ts
import { createApp } from "turnover";
import { otel } from "turnover/otel";

const app = await createApp({ plugins: [otel()] });
```

With no options it opens a `SERVER` span per request named by the **matched
route** (`GET /users/:id`, not the raw URL), sets HTTP semantic-convention
attributes, continues an incoming W3C `traceparent`, and records exceptions /
5xx as errors. The span is the **active** context for the request, so anything
nested attaches to it automatically. Tune it when you need to:

```ts
otel({
  ignore: (ctx) => ctx.route === "/health",          // skip noise
  enrich: (span, ctx) => span.setAttribute("tenant", ctx.store.tenant),
  captureRequestHeaders: ["x-request-id"],
});
```

Add child spans with `@traced` (built on the method-AOP seam), which nest under
the server span. On a **method** it traces that method; on a **class** it traces
every public method — convention over configuration — with a per-method `@noTrace`
opt-out, and options to shape the span:

```ts
import { traced, noTrace } from "turnover/otel";

@traced()                    // trace every public method of this service…
@injectable()
class Orders {
  async place(order: Order) { /* span "Orders.place" */ }

  @noTrace                   // …except this one
  private priceOf(order: Order) { /* not traced */ }
}

// Or trace a single method, configuring the span:
class Payments {
  @traced({ kind: SpanKind.CLIENT, attributes: { "peer.service": "stripe" },
            enrich: (span, jp) => span.setAttribute("charge.id", String(jp.args[0])) })
  async charge(id: string) { /* span "Payments.charge" */ }
}
```

The core package stays dependency-free: `turnover/otel` is a separate entry and
`@opentelemetry/api` is an **optional peer dependency**. Bring your own
OpenTelemetry SDK (exporter, resource, context manager) as usual — with none
registered, every call is a no-op (zero overhead).

### CORS

`cors(options)` is a built-in plugin: it answers preflight `OPTIONS` requests and
adds CORS headers to responses (including errors).

```ts
import { cors, createApp } from "turnover";

const app = await createApp({
  controllers: [...],
  plugins: [cors({ origin: "https://app.example.com", credentials: true })],
});
```

`origin` accepts `true` (reflect the request origin — the default), a string
(`"*"` or a fixed origin), an array/predicate (reflect only when it matches), or
`false`. Also supports `methods`, `allowedHeaders`, `exposedHeaders`,
`credentials`, and `maxAge`.

### OpenAPI

`app.openapi(options)` builds an OpenAPI 3.1 document from the mounted routes —
paths (with `:param` → `{param}`), methods, path/query parameters, request
bodies, and responses. Declare per-route metadata via the route decorator's
`openapi` option.

```ts
@get("/:id", {
  params: IdSchema,
  response: UserSchema,
  openapi: { summary: "Fetch a user", tags: ["users"] },
})
getOne(ctx: Context) { ... }
```

Because Standard Schema doesn't mandate a JSON-Schema export, pass a
`toJsonSchema` converter to include schema bodies (TypeBox schemas already *are*
JSON Schema; Zod via `zod-to-json-schema`):

```ts
const spec = app.openapi({
  info: { title: "My API", version: "1.0.0" },
  toJsonSchema: (s) => convertToJsonSchema(s),
});
// serve it however you like, e.g.:
app.onRequest((req) =>
  new URL(req.url).pathname === "/openapi.json" ? Response.json(spec) : undefined
);
```

Without `toJsonSchema`, the document still lists every path, method, and
parameter (path params default to `string`).

### Typed client

`createClient<paths>(config)` is a minimal, dependency-free typed HTTP client
driven by an `openapi-typescript`-generated `paths` type — the codegen-based
end-to-end type safety (Turnover can't infer client types through decorators).

```ts
// 1. dump the spec:  Bun.write("openapi.json", JSON.stringify(app.openapi({ toJsonSchema })))
// 2. generate types: bunx openapi-typescript openapi.json -o api.d.ts
import type { paths } from "./api";
import { createClient } from "turnover";

const api = createClient<paths>({ baseUrl: "https://api.example.com" });

const { data, error } = await api.get("/users/{id}", { params: { path: { id: "1" } } });
//      ^ typed as the route's response       ^ path/query/body are typed & checked
await api.post("/users", { body: { name: "Ada" } });
```

Options are required only when a route has path params or a body. Pass
`fetch: app.handle` to drive an app in-memory (great for tests).

### Macros

A macro is a **named, parameterized, DI-resolvable bundle** of cross-cutting —
guards, derivers, interceptors, error handlers — applied to a route or controller
with one decorator. Define it once, opt in with `@macro(name, ...args)`. The
factory runs in an injection context at mount time, so it can `inject()` services
and close over them.

```ts
import { defineMacro, macro, inject, Auth, controller, get } from "turnover";

defineMacro("role", (required: string) => {
  const auth = inject(Auth); // resolved at mount — the DI + cross-cutting fusion
  return {
    use: [() => auth.user.roles.includes(required)
      ? undefined : new Response("Forbidden", { status: 403 })],
  };
});

@controller("/admin")
export class AdminController {
  @get("/users") @macro("role", "admin")  // one line replaces guard+derive+…
  listUsers() { /* ... */ }
}
```

A macro can contribute any of `use` / `derive` / `intercept` / `catchError`;
class- and method-level `@macro` both apply, and multiple compose.

### Events

An in-process publish/subscribe bus for decoupling. Inject `Events`, `publish()`
event objects, and subscribe with `@onEvent(EventType)`. `publish` awaits every
listener (a failing one is logged, not propagated).

```ts
class UserCreated { constructor(readonly id: string) {} }

@injectable()
class Emailer {
  @onEvent(UserCreated)
  async welcome(e: UserCreated) { await sendEmail(e.id); }
}

@controller("/users")
class UsersController {
  private events = inject(Events);
  @post("/") async create(ctx: Context) {
    const user = await save(await ctx.body());
    await this.events.publish(new UserCreated(user.id)); // fan out
    return user;
  }
}

// list listener services so they subscribe at boot (if nothing else injects them)
const app = await createApp({ controllers: [UsersController], listeners: [Emailer] });
```

### Scheduled tasks

`@scheduled({ interval })` runs a service method on a fixed interval while the app
is listening (started by `listen()`, stopped by `stop()`). `runOnStart: true` also
runs it once at startup. A failing run is logged, not propagated.

```ts
@injectable()
class Reminders {
  @scheduled({ interval: 60_000, runOnStart: true })
  async sweep() { /* runs every minute */ }
}

// list it so it's constructed at boot (unless something else injects it)
const app = await createApp({ controllers: [...], listeners: [Reminders] });
app.listen(3000); // scheduled tasks now running
```

For cron expressions, layer an external cron library over the same methods.

### Modules

Group controllers into mountable, prefixed units with `@module`, and compose
them (including nesting) into an app. A module shares a `prefix` and its
cross-cutting concerns — `use` (guards), `derive`, `catchError` — with every
controller it mounts, and with any nested `modules`.

```ts
import { module, createApp } from "turnover";

@module({
  prefix: "/admin",
  use: [authenticate],                    // guards for every route below
  derive: [(ctx) => ({ tenant: tenantOf(ctx) })],
  controllers: [UsersController, RolesController],
  modules: [BillingModule],               // nested; inherits /admin + the guard
})
class AdminModule {}

const app = await createApp({ modules: [AdminModule] });
// GET /admin/users, /admin/roles, /admin/billing/... — all behind `authenticate`
```

Prefixes compose across nesting (`/admin` + `/billing` + a controller's base).
Modules and explicit `controllers` can be combined in one `createApp`. Import
cycles are broken automatically; a shared module may still be mounted under
several parents.

### In-memory requests & testing

`app.handle(request)` runs a single `Request` through the whole pipeline (routing,
guards, DI, response coercion) and returns a `Response` — **without opening a
socket**. `listen()` serves through the same method, so an in-memory call behaves
exactly like a live request. That makes it ideal for tests and offline tooling:

```ts
const app = await createApp({ controllers: [UsersController] });

const res = await app.handle(new Request("http://local/users/1"));
expect(res.status).toBe(200);
expect(await res.json()).toEqual({ user: { id: "1", name: "Ada" } });
```

`listen(port)` returns Bun's [`Server`](https://bun.sh/docs/api/http) — use
`.stop()`, `.port`, and `.url` on it directly, and pass `0` for an OS-assigned
port (handy for parallel test servers):

```ts
const server = app.listen(0);
const res = await fetch(`${server.url}users`);
server.stop();
```

### Runtime interop (WinterTC)

The request pipeline is a standard `(Request) => Promise<Response>` fetch handler
built on the [WinterTC Minimum Common API](https://min-common-api.proposal.wintertc.org/)
(`Request`, `Response`, `Headers`, `URL`, …). `app.fetch` exposes it, so a
Turnover app deploys unchanged on any compliant runtime — Cloudflare Workers,
Deno Deploy, Vercel — via the standard default export:

```ts
const app = await createApp({ controllers: [UsersController] });
export default app;                    // Workers/Deno look for `default.fetch`
// or: export default { fetch: app.fetch };
```

> `app.listen()` uses `Bun.serve`; `app.fetch` is the runtime-agnostic entry.
> Auto-discovery needs a filesystem, so on no-FS runtimes register controllers
> explicitly (or bundle with `turnoverPlugin()`).

**`app.delegate(path, handler)`** composes any other WinterTC-compliant handler
at a path prefix — another Turnover app or a raw `(Request) => Response`. The
prefix is stripped, so the sub-app sees paths relative to its mount point:

```ts
// any WinterTC handler: a raw (Request) => Response, or another app's `fetch`
const legacy = (req: Request) => Response.json({ ok: true });

app.delegate("/legacy", legacy);         // GET /legacy/... → the delegated handler
app.delegate("/v2", (await createApp({ controllers: [V2] })).fetch); // Turnover-in-Turnover
```

The delegate owns its whole prefix (including its own 404s); the longest matching
prefix wins. Configure at construction with `createApp({ delegate: { "/legacy": legacy.fetch } })`.

## The example app

A runnable demo lives in [example/](example/) — it is **not** part of the
published package. Start it (hot reload via `--watch`):

```bash
bun install
bun run dev   # serves example/ on http://localhost:3000, auto-discovering its controllers
```

On boot it prints the discovered route table; then hit it:

```bash
# create a user
curl -X POST localhost:3000/users -H 'content-type: application/json' \
  -d '{"id":"1","name":"Ada"}'

# list users
curl localhost:3000/users

# authenticated route (see example/auth.ts for the toy token table)
curl localhost:3000/me -H 'authorization: Bearer alice-token'

# admin-only route
curl localhost:3000/me/admin -H 'authorization: Bearer alice-token'
```

## Public API

Everything is imported from the package root — `import { … } from "turnover"`.
OpenTelemetry lives in the `turnover/otel` subpath (`otel`, `traced`), so the
core stays dependency-free. Build-time tooling lives in `turnover/bundler`
(`turnoverPlugin`, `scanControllerFiles`). Two interfaces are augmented via subpaths: `Principal` from `turnover/auth` and
`RequestStore` from `turnover/request`.

| Export | Kind | Purpose |
| ------ | ---- | ------- |
| `createApp`, `App`, `CreateAppOptions` | bootstrap | Discover controllers, wire DI, build routes, `listen()` or `handle(req)`. |
| `App.fetch`, `App.delegate`, `FetchHandler` | interop | WinterTC `(Request) => Response` entry (deploy anywhere) + compose other compliant apps at a prefix. |
| `controller`, `get`, `post`, `put`, `patch`, `del` | decorators | Define a REST controller and its routes. |
| `use`, `Guard` | middleware | Attach guards to a controller or route. |
| `intercept`, `Interceptor` | around advice | Wrap a handler — before/after, transform, short-circuit, catch. |
| `RequestHook`, `ResponseHook`, `StartHook`, `StopHook`, `Plugin` | lifecycle | `onRequest`/`onResponse` + `onStart`/`onStop` hooks; plugins bundle them. |
| `cors`, `CorsOptions` | plugin | Built-in CORS (preflight + response headers). |
| `App.openapi`, `OpenApiOptions`, `OpenApiDocument`, `RouteOptions` | openapi | Generate an OpenAPI 3.1 doc from the routes. |
| `createClient`, `Client`, `ClientConfig`, `ClientResult` | typed client | Typed HTTP client from an `openapi-typescript` `paths` type. |
| `HttpError` (+ subclasses), `catchError`, `ErrorHandler`, `toErrorResponse` | errors | HTTP error types + handlers mapping thrown values to responses. |
| `StandardSchemaV1`, `RouteSchemas`, `InferOutput`, `validate` | validation | Validate `body`/`query`/`params`/`response` via Standard Schema. |
| `Cookies`, `CookieOptions`, `ResponseState` | response | Shape the response via `ctx.set` (status/headers) and `ctx.cookies`. |
| `BodyParser`, `ResponseSerializer` | codecs | Content-negotiated request parsing + response serialization. |
| `injectable`, `inject`, `injectAll`, `Container`, `Scope` | DI | Register and resolve services. |
| `InjectionToken`, `Token`, `Provider`, `ProviderDef` | DI providers | Bind tokens to values/classes/factories/aliases; interface + multi-inject. |
| `postConstruct`, `preDestroy` | DI lifecycle | Per-service init (awaited at bootstrap) + teardown on `app.stop()`. |
| `Config`, `value`, `requireValue`, `ConfigSource`, `profile` | config | Typed config/env reads + profile-gated mounting. |
| `PostProcessor`, `Container.addPostProcessor` | AOP seam | Wrap/replace constructed instances (foundation for method advice). |
| `before`, `after`, `around`, `JoinPoint`, `ProceedingJoinPoint` | method AOP | Advise any injectable service method. |
| `addAround`, `decoratorMeta`, `classMeta`, `MetaBag` | extension | Programmatic advice + decorator-metadata access, to build your own AOP decorators & plugins (how `@traced`/`otel()` are built). |
| `turnoverPlugin`, `scanControllerFiles` (from `turnover/bundler`) | build | Bundle auto-discovered controllers into a `bun build` (build-time scan). |
| `transactional`, `TransactionManager`, `TRANSACTION_MANAGER` | transactions | Run a method in a pluggable unit-of-work. |
| `cacheable`, `cacheEvict`, `CacheStore`, `CACHE_STORE`, `MemoryCache` | caching | Memoize method results in a pluggable store. |
| `Auth`, `Principal`, `requireAuth` | auth | Request-scoped principal accessor + guard. |
| `getRequestState`, `setPrincipal`, `RequestState` | request scope | Read/attach per-request state (backed by `AsyncLocalStorage`). |
| `derive`, `resolve`, `Deriver`, `RequestStore`, `getRequestStore` | request context | Compute per-request values (`ctx.store`) before guards / after validation. |
| `AfterResponseHook`, `TraceHook`, `TraceEvent` | lifecycle | `onAfterResponse` (fire-and-forget) + `onTrace` (per-request timing). |
| `module`, `ModuleOptions` | composition | Group controllers under a prefix with shared cross-cutting; nestable. |
| `defineMacro`, `macro`, `MacroHooks`, `MacroFactory` | macros | Named, parameterized, DI-resolvable cross-cutting bundles. |
| `Events`, `onEvent`, `EventType` | events | In-process publish/subscribe for decoupling. |
| `scheduled`, `Scheduler`, `ScheduledOptions` | scheduling | Run service methods on a fixed interval. |
| `service`, `repository` | stereotypes | `@injectable` aliases for service/DAO components. |
| `Context`, `Ctor`, `HttpMethod` | types | Handler context and shared type aliases. |

## Project layout

The **framework is `src/`** — that (plus `dist/`) is all the package ships. The
demo lives in `example/`, which is never published.

```
src/                    # the framework (the published package)
  index.ts              #   public API barrel — the "turnover" entry
  app.ts                #   createApp, App, discovery, Response coercion
  http.ts               #   @controller, route decorators, @use, Context
  di.ts                 #   Container, inject(), @injectable, providers
  auth.ts               #   Auth accessor, Principal (augment via turnover/auth)
  request.ts            #   AsyncLocalStorage request scope, RequestStore
  metadata.ts           #   Symbol.metadata polyfill + shared metadata keys
  …                     #   aop, cache, config, cors, error, events, macro,
                        #   module, openapi, scheduling, schema, transaction, client
example/                # runnable demo — NOT part of the package
  index.ts              #   createApp().listen(3000)
  users.controller.ts
  me.controller.ts
  greeting.service.ts
  auth.ts               #   demo authenticate / requireRole guards
test/                   # the test suite (bun test)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the house rules under
[contributing/](contributing/): [coding](contributing/coding-best-practices.md),
[testing](contributing/testing-best-practices.md),
[linting](contributing/linting-best-practices.md), and
[releasing](contributing/releasing.md).

## Requirements

- [Bun](https://bun.sh) (uses `Bun.serve`, `Bun.Glob`, `Bun.main`, `Bun.file`).
- Standard TC39 decorators only — works under the default `tsconfig.json`; no
  decorator-related compiler flags are enabled.