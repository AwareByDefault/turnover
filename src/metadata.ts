/**
 * Standard-decorator metadata support.
 *
 * TC39 decorators share a `context.metadata` bag across every decorator on a
 * class and its members, and attach it to the class as `Class[Symbol.metadata]`.
 * `Symbol.metadata` is only defined by very recent lib typings/runtimes, so we
 * define the well-known symbol here if it's missing.
 *
 * This is a plain polyfill of a standard well-known symbol — NOT
 * `experimentalDecorators`. It requires no tsconfig flag and works under the
 * default lib. We reach the symbol through a cast so the code also type-checks
 * on libs that don't yet declare `Symbol.metadata`.
 */
;(Symbol as { metadata?: symbol }).metadata ??= Symbol.for('Symbol.metadata')

const METADATA = (Symbol as { metadata?: symbol }).metadata as symbol

/** Any newable class (constructed by the container with no arguments). */
export type Ctor<T = unknown> = new (...args: never[]) => T

/** The HTTP verbs a route decorator (`@get`, `@post`, …) can bind a handler to. */
export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | 'HEAD'

/**
 * One route recorded by a verb decorator (`@get`/`@post`/…) on a controller
 * method. The array of these under {@link ROUTES} is read at mount time to build
 * the router.
 */
export interface RouteMeta {
  /** The HTTP verb the route responds to. */
  method: HttpMethod
  /** The route path, relative to the controller's base path. */
  path: string
  /** Name of the controller method that handles the route. */
  handlerName: string | symbol
  /** Standard Schemas declared on the route decorator, if any. */
  schemas?: import('./schema').RouteSchemas
  /** OpenAPI metadata declared on the route decorator, if any. */
  openapi?: import('./openapi').OperationMeta
}

// Keys used inside the shared `context.metadata` bag.
/** Metadata key: a bean's DI scope, written by `@injectable`/`@service`/`@repository` and read when the container constructs it. */
export const SCOPE = Symbol('aware.scope')
/** Metadata key: the array of {@link RouteMeta} a controller's verb decorators (`@get`/`@post`/…) record, read at mount time to build the router. */
export const ROUTES = Symbol('aware.routes')
/** Metadata key: the controller-wide `Guard[]` a class-level `@use` appends; applied to every route. */
export const CLASS_GUARDS = Symbol('aware.classGuards')
/** Metadata key: per-method `Guard[]` (a `Map` keyed by method name) a method-level `@use` appends. */
export const METHOD_GUARDS = Symbol('aware.methodGuards')
/** Metadata key: the controller-wide `ErrorHandler[]` a class-level `@catchError` appends. */
export const CLASS_ERROR_HANDLERS = Symbol('aware.classErrorHandlers')
/** Metadata key: per-method `ErrorHandler[]` (a `Map` keyed by method name) a method-level `@catchError` appends. */
export const METHOD_ERROR_HANDLERS = Symbol('aware.methodErrorHandlers')
/** Metadata key: the controller-wide `Deriver[]` a class-level `@derive` appends (run before guards). */
export const CLASS_DERIVERS = Symbol('aware.classDerivers')
/** Metadata key: per-method `Deriver[]` (a `Map` keyed by method name) a method-level `@derive` appends. */
export const METHOD_DERIVERS = Symbol('aware.methodDerivers')
/** Metadata key: the controller-wide `Interceptor[]` a class-level `@intercept` appends. */
export const CLASS_INTERCEPTORS = Symbol('aware.classInterceptors')
/** Metadata key: per-method `Interceptor[]` (a `Map` keyed by method name) a method-level `@intercept` appends. */
export const METHOD_INTERCEPTORS = Symbol('aware.methodInterceptors')
/** Metadata key: a controller's base path string, written by `@controller` and read at mount time. */
export const CONTROLLER_BASE = Symbol('aware.controllerBase')
/** Metadata key: a class's `ModuleOptions`, written by `@module` and read when the module is expanded. */
export const MODULE = Symbol('aware.module')
/** Metadata key: the method names marked `@postConstruct`, run by the container after construction. */
export const POST_CONSTRUCT = Symbol('aware.postConstruct')
/** Metadata key: the method names marked `@preDestroy`, run in reverse construction order on `app.stop()`. */
export const PRE_DESTROY = Symbol('aware.preDestroy')
/** Metadata key: the profile names a `@profile` gates mounting on, read at mount time. */
export const PROFILE = Symbol('aware.profile')
/** Metadata key: per-method before/after/around advice, written by `@before`/`@after`/`@around` (and `addAround`) and applied by `aspectProcessor`. */
export const ADVICE = Symbol('aware.advice')
/** Metadata key: the class-level `@macro` applications, expanded at mount time. */
export const CLASS_MACROS = Symbol('aware.classMacros')
/** Metadata key: per-method `@macro` applications (a `Map` keyed by method name), expanded at mount time. */
export const METHOD_MACROS = Symbol('aware.methodMacros')
/** Metadata key: the controller-wide `Deriver[]` a class-level `@resolve` appends (run after input validation). */
export const CLASS_RESOLVERS = Symbol('aware.classResolvers')
/** Metadata key: per-method `Deriver[]` (a `Map` keyed by method name) a method-level `@resolve` appends. */
export const METHOD_RESOLVERS = Symbol('aware.methodResolvers')
/** Metadata key: the `@onEvent` subscriptions on a class, read by the event-listener post-processor to wire them on construction. */
export const EVENT_LISTENERS = Symbol('aware.eventListeners')
/** Metadata key: the set of method names to run in the bound `TransactionManager`, written by `@transactional` (and by `@repository` for every method) and applied by the transactional post-processor. */
export const TRANSACTIONAL = Symbol('aware.transactional')
/** Metadata key: per-method `@cacheable` options (a `Map` keyed by method name), applied by the cache post-processor. */
export const CACHEABLE = Symbol('aware.cacheable')
/** Metadata key: the set of `@cacheEvict` method names, applied by the cache post-processor. */
export const CACHE_EVICT = Symbol('aware.cacheEvict')
/** Metadata key: per-method `@scheduled` options (a `Map` keyed by method name), read by the scheduling post-processor. */
export const SCHEDULED = Symbol('aware.scheduled')

/**
 * A decorator-metadata bag — the shared `Symbol.metadata` object that every
 * decorator on a class (and its members) reads and writes. Store your own
 * `Symbol`-keyed entries on it to coordinate between decorators (e.g. a class
 * decorator that reacts to markers left by member decorators).
 */
export type MetaBag = Record<PropertyKey, unknown>

/**
 * The shared metadata bag for the class being decorated, taken from a
 * decorator's `context`. Pair it with `addAround` (or your own bookkeeping) to
 * build custom decorators and plugins on the AOP seam. The runtime always
 * provides the bag during decoration, so the `undefined` is cast away.
 *
 * ```ts
 * function audited() {
 *   return (cls, context: ClassDecoratorContext) => {
 *     const meta = decoratorMeta(context)
 *     for (const name of methodsOf(cls)) addAround(meta, name, advice)
 *   }
 * }
 * ```
 *
 * @param context - The decorator context whose shared `metadata` bag is returned.
 */
export function ctxMeta(context: { metadata: unknown }): MetaBag {
  return context.metadata as MetaBag
}

/**
 * The metadata bag attached to a class at runtime (`Class[Symbol.metadata]`),
 * or `undefined` if it carries none — the read side of {@link ctxMeta}. Use it
 * in a container post-processor to inspect a class's decorator metadata and
 * decide whether (and how) to wrap its instances.
 *
 * @param target - The class whose attached metadata bag to read.
 * @returns The class's metadata bag, or `undefined` if it carries none.
 */
export function metadataOf(target: Ctor): MetaBag | undefined {
  return (target as unknown as MetaBag)[METADATA] as MetaBag | undefined
}
