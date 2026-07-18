import {
  CLASS_GUARDS,
  type Ctor,
  ctxMeta,
  type HttpMethod,
  METHOD_GUARDS,
  type RouteMeta,
  ROUTES,
} from "./metadata";

/** Per-request context passed to every route handler. */
export interface Context<
  Params extends Record<string, string> = Record<string, string>,
> {
  readonly req: Request;
  /** Path params captured from the route pattern (e.g. `/:id`). */
  readonly params: Params;
  /** Parsed query string. */
  readonly query: URLSearchParams;
  /** Lazily read + parse the body (JSON when the content-type says so). */
  body<T = unknown>(): Promise<T>;
}

/**
 * A guard / middleware. Return (or throw) a `Response` to short-circuit the
 * request (e.g. a 401); return nothing to continue to the next guard/handler.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: a guard returns nothing (continue) or a Response (short-circuit); void keeps both sync and async no-return guards assignable
export type Guard = (ctx: Context) => void | Response | Promise<void | Response>;

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
  return (value: Ctor, _context: ClassDecoratorContext): void => {
    controllers.push({ target: value, base });
  };
}

function route(method: HttpMethod) {
  return (path = "") =>
    (_value: unknown, context: ClassMethodDecoratorContext): void => {
      const meta = ctxMeta(context);
      const routes = (meta[ROUTES] as RouteMeta[] | undefined) ?? [];
      routes.push({ method, path, handlerName: context.name });
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
