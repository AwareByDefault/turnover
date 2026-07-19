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

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | 'HEAD'

export interface RouteMeta {
  method: HttpMethod
  path: string
  handlerName: string | symbol
  /** Standard Schemas declared on the route decorator, if any. */
  schemas?: import('./schema').RouteSchemas
  /** OpenAPI metadata declared on the route decorator, if any. */
  openapi?: import('./openapi').OperationMeta
}

// Keys used inside the shared `context.metadata` bag.
export const SCOPE = Symbol('aware.scope')
export const ROUTES = Symbol('aware.routes')
export const CLASS_GUARDS = Symbol('aware.classGuards')
export const METHOD_GUARDS = Symbol('aware.methodGuards')
export const CLASS_ERROR_HANDLERS = Symbol('aware.classErrorHandlers')
export const METHOD_ERROR_HANDLERS = Symbol('aware.methodErrorHandlers')
export const CLASS_DERIVERS = Symbol('aware.classDerivers')
export const METHOD_DERIVERS = Symbol('aware.methodDerivers')
export const CLASS_INTERCEPTORS = Symbol('aware.classInterceptors')
export const METHOD_INTERCEPTORS = Symbol('aware.methodInterceptors')
export const CONTROLLER_BASE = Symbol('aware.controllerBase')
export const MODULE = Symbol('aware.module')
export const POST_CONSTRUCT = Symbol('aware.postConstruct')
export const PRE_DESTROY = Symbol('aware.preDestroy')
export const PROFILE = Symbol('aware.profile')
export const ADVICE = Symbol('aware.advice')
export const CLASS_MACROS = Symbol('aware.classMacros')
export const METHOD_MACROS = Symbol('aware.methodMacros')
export const CLASS_RESOLVERS = Symbol('aware.classResolvers')
export const METHOD_RESOLVERS = Symbol('aware.methodResolvers')
export const EVENT_LISTENERS = Symbol('aware.eventListeners')
export const TRANSACTIONAL = Symbol('aware.transactional')
export const CACHEABLE = Symbol('aware.cacheable')
export const CACHE_EVICT = Symbol('aware.cacheEvict')
export const SCHEDULED = Symbol('aware.scheduled')
export const REPOSITORY = Symbol('aware.repository')

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
 */
export function ctxMeta(context: { metadata: unknown }): MetaBag {
  return context.metadata as MetaBag
}

/**
 * The metadata bag attached to a class at runtime (`Class[Symbol.metadata]`),
 * or `undefined` if it carries none — the read side of {@link ctxMeta}. Use it
 * in a container post-processor to inspect a class's decorator metadata and
 * decide whether (and how) to wrap its instances.
 */
export function metadataOf(target: Ctor): MetaBag | undefined {
  return (target as unknown as MetaBag)[METADATA] as MetaBag | undefined
}
