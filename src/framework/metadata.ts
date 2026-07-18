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
(Symbol as { metadata?: symbol }).metadata ??= Symbol.for("Symbol.metadata");

const METADATA = (Symbol as { metadata?: symbol }).metadata as symbol;

/** Any newable class (constructed by the container with no arguments). */
export type Ctor<T = unknown> = new (...args: never[]) => T;

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

export interface RouteMeta {
  method: HttpMethod;
  path: string;
  handlerName: string | symbol;
  /** Standard Schemas declared on the route decorator, if any. */
  schemas?: import("./schema").RouteSchemas;
}

// Keys used inside the shared `context.metadata` bag.
export const SCOPE = Symbol("aware.scope");
export const ROUTES = Symbol("aware.routes");
export const CLASS_GUARDS = Symbol("aware.classGuards");
export const METHOD_GUARDS = Symbol("aware.methodGuards");
export const CLASS_ERROR_HANDLERS = Symbol("aware.classErrorHandlers");
export const METHOD_ERROR_HANDLERS = Symbol("aware.methodErrorHandlers");
export const CONTROLLER_BASE = Symbol("aware.controllerBase");

/** A writable view of a metadata bag. */
export type MetaBag = Record<PropertyKey, unknown>;

/**
 * The shared metadata bag for a decorator context. The runtime always provides
 * one during decoration, so we cast away the type's `undefined`.
 */
export function ctxMeta(context: { metadata: unknown }): MetaBag {
  return context.metadata as MetaBag;
}

/** Read the decorator-metadata bag attached to a class (if any). */
export function metadataOf(target: Ctor): MetaBag | undefined {
  return (target as unknown as MetaBag)[METADATA] as MetaBag | undefined;
}
