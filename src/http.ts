import type { Cookies } from './cookies'
import {
  CLASS_DERIVERS,
  CLASS_ERROR_HANDLERS,
  CLASS_GUARDS,
  CLASS_INTERCEPTORS,
  CLASS_RESOLVERS,
  CONTROLLER_BASE,
  type Ctor,
  ctxMeta,
  type HttpMethod,
  METHOD_DERIVERS,
  METHOD_ERROR_HANDLERS,
  METHOD_GUARDS,
  METHOD_INTERCEPTORS,
  METHOD_RESOLVERS,
  ROUTES,
  type RouteMeta,
} from './metadata'
import type { OperationMeta } from './openapi'
import type { RequestStore } from './request'
import type { RouteSchemas } from './schema'

/**
 * Per-request context passed to every route handler.
 *
 * @typeParam Params - shape of the path params captured from the route pattern.
 */
export interface Context<
  Params extends Record<string, string> = Record<string, string>,
> {
  /** The incoming Web `Request`. */
  readonly req: Request
  /**
   * The matched route pattern (e.g. `/users/:id`) — low-cardinality, unlike
   * `req.url`. Use it for telemetry span names / metric labels and structured
   * logging. `""` for a 404 (no route matched).
   */
  readonly route: string
  /** Path params captured from the route pattern (e.g. `/:id`). */
  readonly params: Params
  /** Parsed query string. */
  readonly query: URLSearchParams
  /**
   * Lazily read + parse the raw body (JSON when the content-type says so).
   *
   * @typeParam T - The expected parsed-body type you assert (it is not validated).
   * @returns A promise of the parsed body, cached so repeated calls read it once.
   */
  body<T = unknown>(): Promise<T>
  /**
   * Validated inputs, populated for whichever of `body`/`query`/`params` the
   * route declared a schema for. Each is the schema's *output* type — cast to it
   * (e.g. `ctx.valid.body as CreateUser`), since standard decorators can't flow
   * the schema's type onto the handler signature.
   */
  readonly valid: ValidatedInputs
  /** Mutate the outgoing response's status and headers. */
  readonly set: ResponseState
  /** Read incoming cookies and queue `Set-Cookie`s on the response. */
  readonly cookies: Cookies
  /** Per-request values populated by `@derive` handlers (augment `RequestStore`). */
  readonly store: RequestStore
}

/** Validated request inputs; a field is set only when its schema is declared. */
export interface ValidatedInputs {
  /** Validated (and coerced) body — set when a `body` schema is declared. */
  body?: unknown
  /** Validated query object — set when a `query` schema is declared. */
  query?: unknown
  /** Validated path params — set when a `params` schema is declared. */
  params?: unknown
}

/** Mutable response state a handler can write via `ctx.set`. */
export interface ResponseState {
  /** Status for a coerced (non-`Response`) return value. */
  status?: number
  /** Headers merged onto the outgoing response. */
  headers: Headers
}

/**
 * A guard / middleware. Return (or throw) a `Response` to short-circuit the
 * request (e.g. a 401); return nothing to continue to the next guard/handler.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: a guard returns nothing (continue) or a Response (short-circuit); void keeps both sync and async no-return guards assignable
export type Guard = (ctx: Context) => void | Response | Promise<void | Response>

/**
 * An error handler. Runs when a route handler or guard throws (anything other
 * than a `Response`, which short-circuits directly). Return a `Response` to
 * handle the error, or return nothing to defer to the next handler in the chain
 * (route → controller → global → the framework default).
 */
export type ErrorHandler = (
  err: unknown,
  ctx: Context,
  // biome-ignore lint/suspicious/noConfusingVoidType: handled (Response) vs defer (nothing), sync or async
) => void | Response | Promise<void | Response>

/**
 * A deriver computes per-request values *before guards run*. Return an object to
 * merge into `ctx.store`, or write `ctx.store` directly. Throw (e.g. an
 * `HttpError`) to abort the request.
 */
export type Deriver = (
  ctx: Context,
  // biome-ignore lint/suspicious/noConfusingVoidType: a deriver may return nothing (void) or a partial store, sync or async
) => void | Partial<RequestStore> | Promise<void | Partial<RequestStore>>

/**
 * An around-advice interceptor. It runs after guards and wraps the handler:
 * call `next()` to run the rest of the chain (returning its `Response`), with
 * your own code before and/or after. Skip `next()` to short-circuit, or
 * transform its result. Interceptors nest — outer ones wrap inner ones.
 */
export type Interceptor = (
  ctx: Context,
  next: () => Promise<Response>,
) => Response | Promise<Response>

/** A registered controller: its class and the base path it mounts under. */
export interface ControllerMeta {
  /** The controller class (constructor), resolved through DI at mount time. */
  target: Ctor
  /** Base path prepended to every route in the controller (from `@controller`). */
  base: string
}

const controllers: ControllerMeta[] = []

/**
 * Controllers registered so far (populated as their modules are imported).
 *
 * @returns The controllers on the global registry, in registration order.
 */
export function registeredControllers(): readonly ControllerMeta[] {
  return controllers
}

/**
 * Class decorator: register a class as a REST controller mounted under `base`.
 * Routes and guards are read from the class metadata at mount time, so the
 * relative order of `@controller` and `@use` does not matter.
 *
 * @param base - Base path prepended to every route in the controller (default `""`).
 * @returns A class decorator that registers the controller.
 */
export function controller(base = '') {
  return (value: Ctor, context: ClassDecoratorContext): void => {
    // Record the base on the class metadata too, so a controller can be mounted
    // from the class alone (explicit `createApp({ controllers })`) without going
    // through the global discovery registry.
    ctxMeta(context)[CONTROLLER_BASE] = base
    controllers.push({ target: value, base })
  }
}

/** Options a route decorator accepts: validation schemas plus OpenAPI metadata. */
export interface RouteOptions extends RouteSchemas {
  /** OpenAPI operation metadata (summary, tags, …) for this route. */
  openapi?: OperationMeta
}

function route(method: HttpMethod) {
  return (path = '', options: RouteOptions = {}) => {
    const { openapi, ...schemaFields } = options
    const schemas =
      schemaFields.body ||
      schemaFields.query ||
      schemaFields.params ||
      schemaFields.response
        ? schemaFields
        : undefined
    return (_value: unknown, context: ClassMethodDecoratorContext): void => {
      const meta = ctxMeta(context)
      const routes = (meta[ROUTES] as RouteMeta[] | undefined) ?? []
      routes.push({ method, path, handlerName: context.name, schemas, openapi })
      meta[ROUTES] = routes
    }
  }
}

/** Declare a `GET` route on a controller method. */
export const get = route('GET')
/** Declare a `POST` route on a controller method. */
export const post = route('POST')
/** Declare a `PUT` route on a controller method. */
export const put = route('PUT')
/** Declare a `PATCH` route on a controller method. */
export const patch = route('PATCH')
/** DELETE route (`delete` is a reserved word, so the decorator is named `del`). */
export const del = route('DELETE')

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
 *
 * @param guards - Guards to run before the handler, in listed order.
 * @returns A class or method decorator that attaches the guards.
 */
export function use(...guards: Guard[]) {
  return (
    _value: unknown,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ): void => {
    const meta = ctxMeta(context)
    if (context.kind === 'class') {
      const list = (meta[CLASS_GUARDS] as Guard[] | undefined) ?? []
      list.push(...guards)
      meta[CLASS_GUARDS] = list
    } else {
      const map =
        (meta[METHOD_GUARDS] as Map<PropertyKey, Guard[]> | undefined) ??
        new Map<PropertyKey, Guard[]>()
      const list = map.get(context.name) ?? []
      list.push(...guards)
      map.set(context.name, list)
      meta[METHOD_GUARDS] = map
    }
  }
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
 *
 * @param handlers - Error handlers tried in order until one returns a `Response`.
 * @returns A class or method decorator that attaches the error handlers.
 */
export function catchError(...handlers: ErrorHandler[]) {
  return (
    _value: unknown,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ): void => {
    const meta = ctxMeta(context)
    if (context.kind === 'class') {
      const list =
        (meta[CLASS_ERROR_HANDLERS] as ErrorHandler[] | undefined) ?? []
      list.push(...handlers)
      meta[CLASS_ERROR_HANDLERS] = list
    } else {
      const map =
        (meta[METHOD_ERROR_HANDLERS] as
          | Map<PropertyKey, ErrorHandler[]>
          | undefined) ?? new Map<PropertyKey, ErrorHandler[]>()
      const list = map.get(context.name) ?? []
      list.push(...handlers)
      map.set(context.name, list)
      meta[METHOD_ERROR_HANDLERS] = map
    }
  }
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
 *
 * @param derivers - Derivers run before guards to populate `ctx.store`.
 * @returns A class or method decorator that attaches the derivers.
 */
export function derive(...derivers: Deriver[]) {
  return (
    _value: unknown,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ): void => {
    const meta = ctxMeta(context)
    if (context.kind === 'class') {
      const list = (meta[CLASS_DERIVERS] as Deriver[] | undefined) ?? []
      list.push(...derivers)
      meta[CLASS_DERIVERS] = list
    } else {
      const map =
        (meta[METHOD_DERIVERS] as Map<PropertyKey, Deriver[]> | undefined) ??
        new Map<PropertyKey, Deriver[]>()
      const list = map.get(context.name) ?? []
      list.push(...derivers)
      map.set(context.name, list)
      meta[METHOD_DERIVERS] = map
    }
  }
}

/**
 * Like `@derive`, but runs *after* guards and validation — so it can read
 * `ctx.valid`. Populate `ctx.store` with values derived from validated input
 * (e.g. load the entity named by a now-validated `:id`).
 *
 * @param resolvers - Derivers run after validation to populate `ctx.store`.
 * @returns A class or method decorator that attaches the resolvers.
 */
export function resolve(...resolvers: Deriver[]) {
  return (
    _value: unknown,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ): void => {
    const meta = ctxMeta(context)
    if (context.kind === 'class') {
      const list = (meta[CLASS_RESOLVERS] as Deriver[] | undefined) ?? []
      list.push(...resolvers)
      meta[CLASS_RESOLVERS] = list
    } else {
      const map =
        (meta[METHOD_RESOLVERS] as Map<PropertyKey, Deriver[]> | undefined) ??
        new Map<PropertyKey, Deriver[]>()
      const list = map.get(context.name) ?? []
      list.push(...resolvers)
      map.set(context.name, list)
      meta[METHOD_RESOLVERS] = map
    }
  }
}

/**
 * Attach interceptors to a controller (every route) or a single route. They run
 * after guards and wrap the handler — controller interceptors outside method
 * ones — each calling `next()` to run the rest of the chain.
 *
 * ```ts
 * @get("/") @intercept(async (ctx, next) => {
 *   const res = await next();
 *   res.headers.set("x-timing", "...");
 *   return res;
 * }) list() { ... }
 * ```
 *
 * @param interceptors - Interceptors wrapping the handler; each calls `next()`.
 * @returns A class or method decorator that attaches the interceptors.
 */
export function intercept(...interceptors: Interceptor[]) {
  return (
    _value: unknown,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ): void => {
    const meta = ctxMeta(context)
    if (context.kind === 'class') {
      const list = (meta[CLASS_INTERCEPTORS] as Interceptor[] | undefined) ?? []
      list.push(...interceptors)
      meta[CLASS_INTERCEPTORS] = list
    } else {
      const map =
        (meta[METHOD_INTERCEPTORS] as
          | Map<PropertyKey, Interceptor[]>
          | undefined) ?? new Map<PropertyKey, Interceptor[]>()
      const list = map.get(context.name) ?? []
      list.push(...interceptors)
      map.set(context.name, list)
      meta[METHOD_INTERCEPTORS] = map
    }
  }
}
