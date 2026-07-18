import { pathToFileURL } from "node:url";
import { Cookies } from "./cookies";
import { Container } from "./di";
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
  registeredControllers,
  type ResponseState,
  type ValidatedInputs,
} from "./http";
import {
  CLASS_DERIVERS,
  CLASS_ERROR_HANDLERS,
  CLASS_GUARDS,
  CONTROLLER_BASE,
  type Ctor,
  METHOD_DERIVERS,
  METHOD_ERROR_HANDLERS,
  METHOD_GUARDS,
  metadataOf,
  ROUTES,
  type RouteMeta,
} from "./metadata";
import { type RequestState, runInRequest } from "./request";
import { issuePath, type RouteSchemas, type StandardSchemaV1 } from "./schema";

export interface CreateAppOptions {
  /** Directory to scan for `@controller` files. Defaults to the entry's dir. */
  dir?: string;
  /**
   * Provide controller classes explicitly instead of scanning. Only these are
   * mounted (handy for tests and bundling); importing them runs their decorators.
   */
  controllers?: Ctor[];
  /** Reuse an existing container. */
  container?: Container;
  /**
   * Global error handler(s), tried after any route/controller `@catchError`
   * handlers when a handler or guard throws. See {@link App.onError}.
   */
  onError?: ErrorHandler | ErrorHandler[];
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

/** Join a controller base and a route path into one normalized pattern. */
function joinPath(base: string, path: string): string {
  return normalizePath(`/${base}/${path}`);
}

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

export class App {
  readonly container: Container;
  // The method table for every mounted pattern, kept for `routeTable()` and to
  // merge routes that several controllers contribute to the same pattern.
  private readonly byPattern = new Map<string, Record<string, RouteHandler>>();
  // Fast path: patterns with no params, matched by exact path.
  private readonly staticRoutes = new Map<string, Record<string, RouteHandler>>();
  // Patterns with `:param` segments, matched segment-by-segment.
  private readonly dynamicRoutes: DynamicRoute[] = [];
  // App-wide error handlers, tried after any route/controller-scoped ones.
  private readonly errorHandlers: ErrorHandler[] = [];

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
  mount(meta: ControllerMeta): void {
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

    for (const { method, path, handlerName, schemas } of routes) {
      const pattern = joinPath(meta.base, path);
      const handler = instance[handlerName];
      const guards = [...classGuards, ...(methodGuards.get(handlerName) ?? [])];
      // Class derivers before method derivers (broad context first).
      const derivers = [...classDerivers, ...(methodDerivers.get(handlerName) ?? [])];
      // Most-specific first: route handlers before controller handlers.
      const scopedErrorHandlers = [
        ...(methodErrorHandlers.get(handlerName) ?? []),
        ...classErrorHandlers,
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
            if (schemas) await validateInputs(schemas, ctx);
            let result = await handler.call(instance, ctx);
            if (schemas?.response && !(result instanceof Response)) {
              result = await validateResponse(schemas.response, result);
            }
            return result instanceof Response
              ? result
              : toResponse(result, set.status);
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
   * Start a `Bun.serve` server. Routing goes through `handle()`, so the served
   * behavior matches in-memory `handle()` exactly. Returns Bun's `Server`
   * (`.stop()`, `.port`, `.url`, `.reload()`); pass `0` for an OS-assigned port.
   */
  listen(port = 3000) {
    return Bun.serve({ port, fetch: (req) => this.handle(req) });
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

/**
 * Create an app: discover controllers (or take them explicitly), instantiate
 * each through the DI container, and build the route table. Call `.listen()` to
 * start a `Bun.serve` server, or `.handle(req)` to drive it in-memory.
 */
export async function createApp(options: CreateAppOptions = {}): Promise<App> {
  const container = options.container ?? new Container();

  let metas: ControllerMeta[];
  if (options.controllers) {
    // Explicit mode: mount exactly these classes (not the global registry), so
    // apps and tests are isolated from whatever else has been imported.
    metas = options.controllers.map((target) => ({
      target,
      base: (metadataOf(target)?.[CONTROLLER_BASE] as string | undefined) ?? "",
    }));
  } else {
    await discover(options.dir ?? entryDir());
    metas = [...registeredControllers()];
  }

  const app = new App(container);
  if (options.onError) {
    app.onError(
      ...(Array.isArray(options.onError) ? options.onError : [options.onError])
    );
  }
  for (const meta of metas) app.mount(meta);
  return app;
}
