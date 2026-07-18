import { pathToFileURL } from "node:url";
import { Cookies } from "./cookies";
import { Container, type ProviderDef } from "./di";
import {
  HttpError,
  InternalServerError,
  NotFoundError,
  toErrorResponse,
  UnprocessableEntityError,
} from "./error";
import {
  type Context,
  type ControllerMeta,
  type Deriver,
  type ErrorHandler,
  type Guard,
  type Interceptor,
  registeredControllers,
  type ResponseState,
  type ValidatedInputs,
} from "./http";
import {
  CLASS_DERIVERS,
  CLASS_ERROR_HANDLERS,
  CLASS_GUARDS,
  CLASS_INTERCEPTORS,
  CONTROLLER_BASE,
  type Ctor,
  METHOD_DERIVERS,
  METHOD_ERROR_HANDLERS,
  METHOD_GUARDS,
  METHOD_INTERCEPTORS,
  metadataOf,
  MODULE,
  ROUTES,
  type RouteMeta,
} from "./metadata";
import type { ModuleOptions } from "./module";
import {
  buildOpenApi,
  type OpenApiDocument,
  type OpenApiOptions,
  type OperationRecord,
} from "./openapi";
import { type RequestState, runInRequest } from "./request";
import { issuePath, type RouteSchemas, type StandardSchemaV1 } from "./schema";

/** The `Bun.serve` server returned by `App.listen`. */
type BunServer = ReturnType<typeof Bun.serve>;

/** Runs before routing on every request; return a `Response` to short-circuit. */
export type RequestHook = (
  req: Request
  // biome-ignore lint/suspicious/noConfusingVoidType: continue (nothing) vs short-circuit (Response)
) => void | Response | Promise<void | Response>;

/**
 * Runs after a response is produced (including 404s and errors). Return a
 * `Response` to replace it, or nothing to keep it.
 */
export type ResponseHook = (
  res: Response,
  req: Request
  // biome-ignore lint/suspicious/noConfusingVoidType: replace (Response) vs keep (nothing)
) => void | Response | Promise<void | Response>;

/** Runs once after the server starts listening. */
export type StartHook = (server: BunServer) => void | Promise<void>;

/** Runs once when the app is stopping (before the server closes). */
export type StopHook = () => void | Promise<void>;

/** A bundle of hooks registered together (e.g. what `cors()` returns). */
export interface Plugin {
  onRequest?: RequestHook | RequestHook[];
  onResponse?: ResponseHook | ResponseHook[];
  onStart?: StartHook | StartHook[];
  onStop?: StopHook | StopHook[];
  onError?: ErrorHandler | ErrorHandler[];
}

export interface CreateAppOptions {
  /** Directory to scan for `@controller` files. Defaults to the entry's dir. */
  dir?: string;
  /**
   * Provide controller classes explicitly instead of scanning. Only these are
   * mounted (handy for tests and bundling); importing them runs their decorators.
   */
  controllers?: Ctor[];
  /** Mount `@module`-decorated classes (prefix + shared cross-cutting). */
  modules?: Ctor[];
  /** Bind tokens to providers (`useValue`/`useClass`/`useFactory`/`useExisting`). */
  providers?: ProviderDef[];
  /** Reuse an existing container. */
  container?: Container;
  /**
   * Global error handler(s), tried after any route/controller `@catchError`
   * handlers when a handler or guard throws. See {@link App.onError}.
   */
  onError?: ErrorHandler | ErrorHandler[];
  /** Hook(s) run before routing on every request. See {@link App.onRequest}. */
  onRequest?: RequestHook | RequestHook[];
  /** Hook(s) run after every response. See {@link App.onResponse}. */
  onResponse?: ResponseHook | ResponseHook[];
  /** Hook(s) run once after `listen()`. See {@link App.onStart}. */
  onStart?: StartHook | StartHook[];
  /** Hook(s) run once on `stop()`. See {@link App.onStop}. */
  onStop?: StopHook | StopHook[];
  /** Plugins (hook bundles) to register, e.g. `cors(...)`. */
  plugins?: Plugin[];
}

/** A request augmented with the path params matched from its route pattern. */
type ParamRequest = Request & { params: Record<string, string> };
type RouteHandler = (req: ParamRequest) => Promise<Response>;

/** One path segment of a route pattern: a literal, or a `:name` capture. */
type Segment = { literal: string } | { param: string };

/** A route pattern that contains at least one `:param` segment. */
interface DynamicRoute {
  segments: Segment[];
  methods: Record<string, RouteHandler>;
}

const NO_PARAMS: Record<string, string> = Object.freeze({});

/** Join path segments (module prefix, controller base, route) into one pattern. */
function joinPaths(...parts: string[]): string {
  return normalizePath(`/${parts.join("/")}`);
}

/** Cross-cutting context a module (or nesting of modules) passes to a mount. */
interface InheritedContext {
  prefix: string;
  guards: Guard[];
  derivers: Deriver[];
  interceptors: Interceptor[];
  errorHandlers: ErrorHandler[];
}

const ROOT_CONTEXT: InheritedContext = {
  prefix: "",
  guards: [],
  derivers: [],
  interceptors: [],
  errorHandlers: [],
};

/** Collapse duplicate slashes and drop the trailing slash (except for root). */
function normalizePath(path: string): string {
  const normalized = path.replace(/\/{2,}/g, "/").replace(/(.+)\/$/, "$1");
  return normalized || "/";
}

/** Split a normalized path into its non-empty segments. */
function segmentsOf(path: string): string[] {
  return path.split("/").filter((s) => s !== "");
}

/** Compile a pattern's segments into literals and `:param` captures. */
function compileSegments(pattern: string): Segment[] {
  return segmentsOf(pattern).map((s) =>
    s.startsWith(":") ? { param: s.slice(1) } : { literal: s }
  );
}

async function parseBody<T>(req: Request): Promise<T> {
  const raw = await req.text();
  if (raw === "") return undefined as T;
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
  }
  return raw as T;
}

/** Turn a handler's return value into a Response, honoring `ctx.set.status`. */
function toResponse(result: unknown, status?: number): Response {
  if (result instanceof Response) return result;
  if (result == null) return new Response(null, { status: status ?? 204 });
  if (typeof result === "string") {
    // Set the content-type explicitly: Bun only infers it when a string body is
    // sent over a socket, so setting it here keeps in-memory `handle()` results
    // identical to what `listen()` serves.
    return new Response(result, {
      status,
      headers: { "content-type": "text/plain;charset=utf-8" },
    });
  }
  return Response.json(
    result as Record<string, unknown>,
    status === undefined ? undefined : { status }
  );
}

/** Merge `ctx.set.headers` and queued cookies onto a response. */
function applyOutgoing(
  response: Response,
  set: ResponseState,
  cookies: Cookies
): Response {
  const setCookies = cookies.serialize();
  const headerEntries = [...set.headers];
  if (headerEntries.length === 0 && setCookies.length === 0) return response;

  const headers = new Headers(response.headers);
  for (const [name, value] of headerEntries) headers.set(name, value);
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  // Reuse the body stream; status was already applied during coercion.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Flatten a query string into an object (repeated keys become arrays). */
function queryToObject(params: URLSearchParams): Record<string, string | string[]> {
  const obj: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    obj[key] = all.length > 1 ? all : all[0];
  }
  return obj;
}

/**
 * Validate one input against a schema, returning the validated (possibly
 * coerced) output, or throwing a `422` whose details point at `location`.
 */
async function checkInput(
  schema: StandardSchemaV1,
  value: unknown,
  location: "body" | "query" | "params"
): Promise<unknown> {
  const result = await schema["~standard"].validate(value);
  if (result.issues) {
    throw new UnprocessableEntityError("Validation failed", {
      code: "validation_failed",
      details: {
        location,
        issues: result.issues.map((issue) => ({
          message: issue.message,
          path: issuePath(issue),
        })),
      },
    });
  }
  return result.value;
}

/** Validate each declared input schema and populate `ctx.valid`. */
async function validateInputs(
  schemas: RouteSchemas,
  ctx: Context
): Promise<void> {
  if (schemas.params) {
    ctx.valid.params = await checkInput(schemas.params, ctx.params, "params");
  }
  if (schemas.query) {
    ctx.valid.query = await checkInput(
      schemas.query,
      queryToObject(ctx.query),
      "query"
    );
  }
  if (schemas.body) {
    ctx.valid.body = await checkInput(schemas.body, await ctx.body(), "body");
  }
}

/**
 * Validate a handler's return value against the response schema. A mismatch is
 * a server bug, so it logs and raises a `500` (details are not sent to clients).
 */
async function validateResponse(
  schema: StandardSchemaV1,
  value: unknown
): Promise<unknown> {
  const result = await schema["~standard"].validate(value);
  if (result.issues) {
    console.error("[turnover] Response validation failed:", result.issues);
    throw new InternalServerError();
  }
  return result.value;
}

/** Normalize a single value or array into an array. */
function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

export class App {
  readonly container: Container;
  // The method table for every mounted pattern, kept for `routeTable()` and to
  // merge routes that several controllers contribute to the same pattern.
  private readonly byPattern = new Map<string, Record<string, RouteHandler>>();
  // Fast path: patterns with no params, matched by exact path.
  private readonly staticRoutes = new Map<string, Record<string, RouteHandler>>();
  // Patterns with `:param` segments, matched segment-by-segment.
  private readonly dynamicRoutes: DynamicRoute[] = [];
  // Per-route metadata captured for OpenAPI generation.
  private readonly operations: OperationRecord[] = [];
  // App-wide error handlers, tried after any route/controller-scoped ones.
  private readonly errorHandlers: ErrorHandler[] = [];
  private readonly requestHooks: RequestHook[] = [];
  private readonly responseHooks: ResponseHook[] = [];
  private readonly startHooks: StartHook[] = [];
  private readonly stopHooks: StopHook[] = [];
  private server?: BunServer;

  constructor(container: Container) {
    this.container = container;
  }

  /**
   * Register global error handler(s). They run (in registration order) after a
   * route's/controller's own `@catchError` handlers when a handler or guard
   * throws, until one returns a `Response`. Returns `this` for chaining.
   */
  onError(...handlers: ErrorHandler[]): this {
    this.errorHandlers.push(...handlers);
    return this;
  }

  /** Register hook(s) run before routing on every request (e.g. CORS). */
  onRequest(...hooks: RequestHook[]): this {
    this.requestHooks.push(...hooks);
    return this;
  }

  /**
   * Register hook(s) run after every response (including 404s and errors),
   * in registration order. Each may return a `Response` to replace the current
   * one, or nothing to keep it.
   */
  onResponse(...hooks: ResponseHook[]): this {
    this.responseHooks.push(...hooks);
    return this;
  }

  /** Register a plugin — a bundle of hooks (e.g. `cors(...)`). */
  register(plugin: Plugin): this {
    if (plugin.onRequest) this.onRequest(...asArray(plugin.onRequest));
    if (plugin.onResponse) this.onResponse(...asArray(plugin.onResponse));
    if (plugin.onStart) this.onStart(...asArray(plugin.onStart));
    if (plugin.onStop) this.onStop(...asArray(plugin.onStop));
    if (plugin.onError) this.onError(...asArray(plugin.onError));
    return this;
  }

  /** Register hook(s) run once after the server starts listening. */
  onStart(...hooks: StartHook[]): this {
    this.startHooks.push(...hooks);
    return this;
  }

  /** Register hook(s) run once when the app is stopping. */
  onStop(...hooks: StopHook[]): this {
    this.stopHooks.push(...hooks);
    return this;
  }

  /** Run `onStop` hooks, then stop the server started by `listen()`. */
  async stop(closeActiveConnections = false): Promise<void> {
    for (const hook of this.stopHooks) {
      try {
        await hook();
      } catch (err) {
        console.error("[turnover] onStop hook failed:", err);
      }
    }
    await this.server?.stop(closeActiveConnections);
  }

  /**
   * Run the error-handler chain for a thrown value: scoped handlers first
   * (route → controller), then the global handlers, then the framework default.
   * Never throws, so `handle()` always resolves to a `Response`.
   */
  private async handleError(
    err: unknown,
    ctx: Context,
    scoped: ErrorHandler[]
  ): Promise<Response> {
    for (const handler of [...scoped, ...this.errorHandlers]) {
      try {
        const result = await handler(err, ctx);
        if (result instanceof Response) return result;
      } catch (rethrown) {
        // A handler itself threw — render that instead and stop the chain.
        err = rethrown;
        break;
      }
    }
    if (!(err instanceof HttpError) && !(err instanceof Response)) {
      console.error("[turnover] Unhandled error while handling request:", err);
    }
    return toErrorResponse(err);
  }

  /** Register one handler under a normalized pattern + HTTP method. */
  private addRoute(pattern: string, method: string, handler: RouteHandler): void {
    let methods = this.byPattern.get(pattern);
    if (!methods) {
      methods = {};
      this.byPattern.set(pattern, methods);
      if (pattern.includes("/:")) {
        this.dynamicRoutes.push({ segments: compileSegments(pattern), methods });
      } else {
        this.staticRoutes.set(pattern, methods);
      }
    }
    methods[method] = handler;
  }

  /** Match a path against the dynamic routes, capturing params. */
  private matchDynamic(
    path: string
  ): { methods: Record<string, RouteHandler>; params: Record<string, string> } | null {
    const parts = segmentsOf(path);
    for (const route of this.dynamicRoutes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < parts.length; i += 1) {
        const seg = route.segments[i];
        if ("param" in seg) {
          params[seg.param] = decodeURIComponent(parts[i]);
        } else if (seg.literal !== parts[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { methods: route.methods, params };
    }
    return null;
  }

  /** Instantiate a controller (with DI) and wire its routes + guards. */
  mount(meta: ControllerMeta, inherited: InheritedContext = ROOT_CONTEXT): void {
    const instance = this.container.resolve(meta.target) as Record<
      string | symbol,
      (ctx: Context) => unknown
    >;
    // Routes and guards live in the class metadata, read here (after every
    // decorator on the class has run), so decorator order does not matter.
    const bag = metadataOf(meta.target);
    const routes = (bag?.[ROUTES] as RouteMeta[] | undefined) ?? [];
    const classGuards = (bag?.[CLASS_GUARDS] as Guard[] | undefined) ?? [];
    const methodGuards =
      (bag?.[METHOD_GUARDS] as Map<PropertyKey, Guard[]> | undefined) ??
      new Map<PropertyKey, Guard[]>();
    const classErrorHandlers =
      (bag?.[CLASS_ERROR_HANDLERS] as ErrorHandler[] | undefined) ?? [];
    const methodErrorHandlers =
      (bag?.[METHOD_ERROR_HANDLERS] as Map<PropertyKey, ErrorHandler[]> | undefined) ??
      new Map<PropertyKey, ErrorHandler[]>();
    const classDerivers = (bag?.[CLASS_DERIVERS] as Deriver[] | undefined) ?? [];
    const methodDerivers =
      (bag?.[METHOD_DERIVERS] as Map<PropertyKey, Deriver[]> | undefined) ??
      new Map<PropertyKey, Deriver[]>();
    const classInterceptors =
      (bag?.[CLASS_INTERCEPTORS] as Interceptor[] | undefined) ?? [];
    const methodInterceptors =
      (bag?.[METHOD_INTERCEPTORS] as Map<PropertyKey, Interceptor[]> | undefined) ??
      new Map<PropertyKey, Interceptor[]>();

    for (const { method, path, handlerName, schemas, openapi } of routes) {
      const pattern = joinPaths(inherited.prefix, meta.base, path);
      this.operations.push({ method, pattern, schemas, meta: openapi });
      const handler = instance[handlerName];
      // Broadest-first: module guards, then controller, then route.
      const guards = [
        ...inherited.guards,
        ...classGuards,
        ...(methodGuards.get(handlerName) ?? []),
      ];
      const derivers = [
        ...inherited.derivers,
        ...classDerivers,
        ...(methodDerivers.get(handlerName) ?? []),
      ];
      // Outermost-first: module interceptors, then controller, then route.
      const interceptors = [
        ...inherited.interceptors,
        ...classInterceptors,
        ...(methodInterceptors.get(handlerName) ?? []),
      ];
      // Most-specific first: route, then controller, then module.
      const scopedErrorHandlers = [
        ...(methodErrorHandlers.get(handlerName) ?? []),
        ...classErrorHandlers,
        ...inherited.errorHandlers,
      ];

      this.addRoute(pattern, method, (req) => {
        // The store starts empty; derivers fill it. Cast so apps may augment
        // `RequestStore` with required fields without breaking this init.
        const state: RequestState = {
          req,
          principal: null,
          store: {} as RequestState["store"],
        };
        return runInRequest(state, async () => {
          const validated: ValidatedInputs = {};
          const set: ResponseState = { headers: new Headers() };
          const cookies = new Cookies(req.headers.get("cookie"));
          let bodyPromise: Promise<unknown> | undefined;
          const ctx: Context = {
            req,
            params: req.params ?? {},
            query: new URL(req.url).searchParams,
            valid: validated,
            set,
            cookies,
            store: state.store, // same object, so getRequestStore() sees writes
            // Cache the parse so validation and the handler read the body once.
            body: <T = unknown>() =>
              (bodyPromise ??= parseBody<unknown>(req)) as Promise<T>,
          };

          // Derivers populate ctx.store, then guards (auth), then validation —
          // mirroring Elysia's derive-before-beforeHandle and Nest's ordering.
          const produce = async (): Promise<Response> => {
            for (const deriver of derivers) {
              const derived = await deriver(ctx);
              if (derived) Object.assign(ctx.store, derived);
            }
            for (const guard of guards) {
              const short = await guard(ctx);
              if (short instanceof Response) return short;
            }
            // Validation + handler + response coercion — the interceptor target.
            const core = async (): Promise<Response> => {
              if (schemas) await validateInputs(schemas, ctx);
              let result = await handler.call(instance, ctx);
              if (schemas?.response && !(result instanceof Response)) {
                result = await validateResponse(schemas.response, result);
              }
              return result instanceof Response
                ? result
                : toResponse(result, set.status);
            };
            // Wrap the core with interceptors; the first listed is outermost.
            const chain = interceptors.reduceRight<() => Promise<Response>>(
              (next, interceptor) => () => Promise.resolve(interceptor(ctx, next)),
              core
            );
            return chain();
          };

          let response: Response;
          try {
            response = await produce();
          } catch (err) {
            // Handlers/guards may `throw` a Response (e.g. Auth.user's 401).
            response =
              err instanceof Response
                ? err
                : await this.handleError(err, ctx, scopedErrorHandlers);
          }
          // Apply `set.headers` + queued cookies to whatever response we produced.
          return applyOutgoing(response, set, cookies);
        });
      });
    }
  }

  /**
   * Handle a Web `Request` and return a `Response`, without opening a socket.
   * This is the single request path — `listen()` serves through it — so an
   * in-memory `app.handle(new Request(...))` behaves exactly like a live server.
   * Ideal for tests and offline tooling (e.g. OpenAPI extraction).
   */
  async handle(req: Request): Promise<Response> {
    let response = await this.dispatch(req);
    for (const hook of this.responseHooks) {
      const replaced = await hook(response, req);
      if (replaced instanceof Response) response = replaced;
    }
    return response;
  }

  /** Route a request to its handler (before response hooks are applied). */
  private async dispatch(req: Request): Promise<Response> {
    // Pre-routing hooks (CORS, logging, …); a returned Response short-circuits.
    for (const hook of this.requestHooks) {
      const short = await hook(req);
      if (short instanceof Response) return short;
    }

    const path = normalizePath(new URL(req.url).pathname);

    let methods = this.staticRoutes.get(path);
    let params = NO_PARAMS;
    if (!methods) {
      const match = this.matchDynamic(path);
      if (match) {
        methods = match.methods;
        params = match.params;
      }
    }

    if (!methods) {
      return toErrorResponse(
        new NotFoundError(`No route for ${req.method} ${path}`)
      );
    }

    const handler = methods[req.method];
    if (!handler) {
      return Response.json(
        { error: { message: "Method Not Allowed" } },
        { status: 405, headers: { Allow: Object.keys(methods).join(", ") } }
      );
    }

    (req as ParamRequest).params = params;
    return handler(req as ParamRequest);
  }

  /** A `{ pattern: [methods] }` view of what's mounted — handy for logging. */
  routeTable(): Record<string, string[]> {
    const table: Record<string, string[]> = {};
    for (const [pattern, methods] of this.byPattern) {
      table[pattern] = Object.keys(methods);
    }
    return table;
  }

  /**
   * Build an OpenAPI 3.1 document from the mounted routes. Provide
   * `options.toJsonSchema` to include body/query/params/response schemas
   * (Standard Schema doesn't mandate a JSON-Schema export). Serve it however you
   * like — e.g. `app.onRequest((req) => url==="/openapi.json" ? Response.json(app.openapi()) : undefined)`.
   */
  openapi(options?: OpenApiOptions): OpenApiDocument {
    return buildOpenApi(this.operations, options);
  }

  /**
   * Start a `Bun.serve` server. Routing goes through `handle()`, so the served
   * behavior matches in-memory `handle()` exactly. Returns Bun's `Server`
   * (`.stop()`, `.port`, `.url`, `.reload()`); pass `0` for an OS-assigned port.
   */
  listen(port = 3000) {
    this.server = Bun.serve({ port, fetch: (req) => this.handle(req) });
    for (const hook of this.startHooks) {
      try {
        const result = hook(this.server);
        if (result instanceof Promise) {
          result.catch((err) =>
            console.error("[turnover] onStart hook failed:", err)
          );
        }
      } catch (err) {
        console.error("[turnover] onStart hook failed:", err);
      }
    }
    return this.server;
  }
}

/** Scan `dir` for files that use `@controller(...)` and import them. */
async function discover(dir: string): Promise<void> {
  const glob = new Bun.Glob("**/*.ts");
  for await (const rel of glob.scan({ cwd: dir })) {
    const abs = `${dir}/${rel}`;
    const source = await Bun.file(abs).text();
    if (!/@controller\s*\(/.test(source)) continue;
    await import(pathToFileURL(abs).href); // import -> @controller self-registers
  }
}

/** The directory of the entry script, used as the default scan root. */
function entryDir(): string {
  const main = Bun.main; // absolute path of the entry file
  return main.slice(0, main.lastIndexOf("/"));
}

/** The base path a `@controller` declared, or "". */
function controllerBase(target: Ctor): string {
  return (metadataOf(target)?.[CONTROLLER_BASE] as string | undefined) ?? "";
}

/** A controller to mount together with the module context it inherited. */
interface MountEntry {
  meta: ControllerMeta;
  inherited: InheritedContext;
}

/** Expand a `@module` class into mount entries, composing prefix + cross-cutting. */
function walkModule(
  moduleClass: Ctor,
  parent: InheritedContext,
  stack: Set<Ctor>
): MountEntry[] {
  // `stack` holds the current ancestor chain — skip a module already in it to
  // break import cycles, while still allowing the same module to be mounted
  // under different parents (a legitimate diamond).
  if (stack.has(moduleClass)) return [];
  stack.add(moduleClass);

  const options =
    (metadataOf(moduleClass)?.[MODULE] as ModuleOptions | undefined) ?? {};
  const inherited: InheritedContext = {
    prefix: joinPaths(parent.prefix, options.prefix ?? ""),
    guards: [...parent.guards, ...(options.use ?? [])],
    derivers: [...parent.derivers, ...(options.derive ?? [])],
    interceptors: [...parent.interceptors, ...(options.intercept ?? [])],
    errorHandlers: [...parent.errorHandlers, ...(options.catchError ?? [])],
  };

  const entries: MountEntry[] = [];
  for (const target of options.controllers ?? []) {
    entries.push({ meta: { target, base: controllerBase(target) }, inherited });
  }
  for (const nested of options.modules ?? []) {
    entries.push(...walkModule(nested, inherited, stack));
  }

  stack.delete(moduleClass);
  return entries;
}

/**
 * Create an app. Provide `modules` and/or `controllers` explicitly, or neither
 * to scan the entry directory for `@controller` files. Each controller is
 * instantiated through the DI container and its routes are built. Call
 * `.listen()` to start a `Bun.serve` server, or `.handle(req)` to drive it
 * in-memory.
 */
export async function createApp(options: CreateAppOptions = {}): Promise<App> {
  const container = options.container ?? new Container();
  // Register providers before mounting so controllers can inject them.
  for (const def of options.providers ?? []) container.register(def.provide, def);
  const app = new App(container);
  for (const plugin of options.plugins ?? []) app.register(plugin);
  if (options.onError) app.onError(...asArray(options.onError));
  if (options.onRequest) app.onRequest(...asArray(options.onRequest));
  if (options.onResponse) app.onResponse(...asArray(options.onResponse));
  if (options.onStart) app.onStart(...asArray(options.onStart));
  if (options.onStop) app.onStop(...asArray(options.onStop));

  const entries: MountEntry[] = [];
  const stack = new Set<Ctor>();
  for (const moduleClass of options.modules ?? []) {
    entries.push(...walkModule(moduleClass, ROOT_CONTEXT, stack));
  }
  // Explicit controllers mount at the root, isolated from the global registry.
  for (const target of options.controllers ?? []) {
    entries.push({
      meta: { target, base: controllerBase(target) },
      inherited: ROOT_CONTEXT,
    });
  }
  if (!options.modules && !options.controllers) {
    await discover(options.dir ?? entryDir());
    for (const meta of registeredControllers()) {
      entries.push({ meta, inherited: ROOT_CONTEXT });
    }
  }

  for (const { meta, inherited } of entries) app.mount(meta, inherited);
  return app;
}
