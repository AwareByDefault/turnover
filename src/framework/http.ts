import type { Cookies } from "./cookies";
import {
  CLASS_DERIVERS,
  CLASS_ERROR_HANDLERS,
  CLASS_GUARDS,
  CONTROLLER_BASE,
  type Ctor,
  ctxMeta,
  type HttpMethod,
  METHOD_DERIVERS,
  METHOD_ERROR_HANDLERS,
  METHOD_GUARDS,
  type RouteMeta,
  ROUTES,
} from "./metadata";
import type { RequestStore } from "./request";
import type { RouteSchemas } from "./schema";

/** Per-request context passed to every route handler. */
export interface Context<
  Params extends Record<string, string> = Record<string, string>,
> {
  readonly req: Request;
  /** Path params captured from the route pattern (e.g. `/:id`). */
  readonly params: Params;
  /** Parsed query string. */
  readonly query: URLSearchParams;
  /** Lazily read + parse the raw body (JSON when the content-type says so). */
  body<T = unknown>(): Promise<T>;
  /**
   * Validated inputs, populated for whichever of `body`/`query`/`params` the
   * route declared a schema for. Each is the schema's *output* type — cast to it
   * (e.g. `ctx.valid.body as CreateUser`), since standard decorators can't flow
   * the schema's type onto the handler signature.
   */
  readonly valid: ValidatedInputs;
  /** Mutate the outgoing response's status and headers. */
  readonly set: ResponseState;
  /** Read incoming cookies and queue `Set-Cookie`s on the response. */
  readonly cookies: Cookies;
  /** Per-request values populated by `@derive` handlers (augment `RequestStore`). */
  readonly store: RequestStore;
}

/** Validated request inputs; a field is set only when its schema is declared. */
export interface ValidatedInputs {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

/** Mutable response state a handler can write via `ctx.set`. */
export interface ResponseState {
  /** Status for a coerced (non-`Response`) return value. */
  status?: number;
  /** Headers merged onto the outgoing response. */
  headers: Headers;
}

/**
 * A guard / middleware. Return (or throw) a `Response` to short-circuit the
 * request (e.g. a 401); return nothing to continue to the next guard/handler.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: a guard returns nothing (continue) or a Response (short-circuit); void keeps both sync and async no-return guards assignable
export type Guard = (ctx: Context) => void | Response | Promise<void | Response>;

/**
 * An error handler. Runs when a route handler or guard throws (anything other
 * than a `Response`, which short-circuits directly). Return a `Response` to
 * handle the error, or return nothing to defer to the next handler in the chain
 * (route → controller → global → the framework default).
 */
export type ErrorHandler = (
  err: unknown,
  ctx: Context
  // biome-ignore lint/suspicious/noConfusingVoidType: handled (Response) vs defer (nothing), sync or async
) => void | Response | Promise<void | Response>;

/**
 * A deriver computes per-request values *before guards run*. Return an object to
 * merge into `ctx.store`, or write `ctx.store` directly. Throw (e.g. an
 * `HttpError`) to abort the request.
 */
export type Deriver = (
  ctx: Context
) => void | Partial<RequestStore> | Promise<void | Partial<RequestStore>>;

export interface ControllerMeta {
  target: Ctor;
  base: string;
}

const controllers: ControllerMeta[] = [];

/** Controllers registered so far (populated as their modules are imported). */
export function registeredControllers(): readonly ControllerMeta[] {
  return controllers;
}

/**
 * Class decorator: register a class as a REST controller mounted under `base`.
 * Routes and guards are read from the class metadata at mount time, so the
 * relative order of `@controller` and `@use` does not matter.
 */
export function controller(base = "") {
  return (value: Ctor, context: ClassDecoratorContext): void => {
    // Record the base on the class metadata too, so a controller can be mounted
    // from the class alone (explicit `createApp({ controllers })`) without going
    // through the global discovery registry.
    ctxMeta(context)[CONTROLLER_BASE] = base;
    controllers.push({ target: value, base });
  };
}

function route(method: HttpMethod) {
  return (path = "", schemas?: RouteSchemas) =>
    (_value: unknown, context: ClassMethodDecoratorContext): void => {
      const meta = ctxMeta(context);
      const routes = (meta[ROUTES] as RouteMeta[] | undefined) ?? [];
      routes.push({ method, path, handlerName: context.name, schemas });
      meta[ROUTES] = routes;
    };
}

export const get = route("GET");
export const post = route("POST");
export const put = route("PUT");
export const patch = route("PATCH");
/** DELETE route (`delete` is a reserved word, so the decorator is named `del`). */
export const del = route("DELETE");

/**
 * Attach guards to a controller (every route) or to a single route.
 *
 * ```ts
 * @controller("/admin")
 * @use(authenticate)          // runs before every route in this controller
 * class AdminController {
 *   @get("/") @use(requireAdmin) dashboard() { ... }  // plus this one only
 * }
 * ```
 */
export function use(...guards: Guard[]) {
  return (
    _value: unknown,
    context: ClassDecoratorContext | ClassMethodDecoratorContext
  ): void => {
    const meta = ctxMeta(context);
    if (context.kind === "class") {
      const list = (meta[CLASS_GUARDS] as Guard[] | undefined) ?? [];
      list.push(...guards);
      meta[CLASS_GUARDS] = list;
    } else {
      const map =
        (meta[METHOD_GUARDS] as Map<PropertyKey, Guard[]> | undefined) ??
        new Map<PropertyKey, Guard[]>();
      const list = map.get(context.name) ?? [];
      list.push(...guards);
      map.set(context.name, list);
      meta[METHOD_GUARDS] = map;
    }
  };
}

/**
 * Attach error handlers to a controller (every route) or a single route. They
 * run when a handler/guard throws, most-specific first (route → controller →
 * global), until one returns a `Response`.
 *
 * ```ts
 * @controller("/orders")
 * @catchError((err) => err instanceof DomainError ? Response.json(...) : undefined)
 * class OrdersController { ... }
 * ```
 */
export function catchError(...handlers: ErrorHandler[]) {
  return (
    _value: unknown,
    context: ClassDecoratorContext | ClassMethodDecoratorContext
  ): void => {
    const meta = ctxMeta(context);
    if (context.kind === "class") {
      const list = (meta[CLASS_ERROR_HANDLERS] as ErrorHandler[] | undefined) ?? [];
      list.push(...handlers);
      meta[CLASS_ERROR_HANDLERS] = list;
    } else {
      const map =
        (meta[METHOD_ERROR_HANDLERS] as Map<PropertyKey, ErrorHandler[]> | undefined) ??
        new Map<PropertyKey, ErrorHandler[]>();
      const list = map.get(context.name) ?? [];
      list.push(...handlers);
      map.set(context.name, list);
      meta[METHOD_ERROR_HANDLERS] = map;
    }
  };
}

/**
 * Attach derivers to a controller (every route) or a single route. They run
 * before guards — class derivers before method derivers — to populate
 * `ctx.store` with per-request context (a session, tenant, etc.).
 *
 * ```ts
 * @controller("/orders")
 * @derive((ctx) => ({ tenant: ctx.req.headers.get("x-tenant") }))
 * class OrdersController { ... }
 * ```
 */
export function derive(...derivers: Deriver[]) {
  return (
    _value: unknown,
    context: ClassDecoratorContext | ClassMethodDecoratorContext
  ): void => {
    const meta = ctxMeta(context);
    if (context.kind === "class") {
      const list = (meta[CLASS_DERIVERS] as Deriver[] | undefined) ?? [];
      list.push(...derivers);
      meta[CLASS_DERIVERS] = list;
    } else {
      const map =
        (meta[METHOD_DERIVERS] as Map<PropertyKey, Deriver[]> | undefined) ??
        new Map<PropertyKey, Deriver[]>();
      const list = map.get(context.name) ?? [];
      list.push(...derivers);
      map.set(context.name, list);
      meta[METHOD_DERIVERS] = map;
    }
  };
}
