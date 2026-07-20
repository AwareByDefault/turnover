import type { Deriver, ErrorHandler, Guard, Interceptor } from './http'
import { type Ctor, ctxMeta, MODULE } from './metadata'

/**
 * How a module groups controllers. A module is a mount point: it prepends a
 * `prefix` to its controllers' routes and shares guards/derivers/error handlers
 * with all of them (and with any nested modules).
 */
export interface ModuleOptions {
  /** Path prefix prepended to every route mounted here; nested modules' prefixes concatenate outer-to-inner. */
  prefix?: string
  /** Controllers mounted here — each gets this prefix and all the cross-cutting concerns below. */
  controllers?: Ctor[]
  /** Nested modules, mounted under this module's prefix and inheriting its cross-cutting concerns. */
  modules?: Ctor[]
  /** Guards for every route in this module (and nested modules); run before controller- and route-level guards. */
  use?: Guard[]
  /** Derivers for every route in this module (and nested); run before guards, outermost-first (module → controller → route). */
  derive?: Deriver[]
  /** Interceptors wrapping every route in this module (and nested); the module's wrap the controller's, which wrap the route's. */
  intercept?: Interceptor[]
  /** Error handlers for every route in this module (and nested); tried after route and controller handlers but before the global one. */
  catchError?: ErrorHandler[]
}

/**
 * Class decorator: declare a module that mounts a group of controllers under a
 * shared prefix and cross-cutting concerns. Pass the module class to
 * `createApp({ modules: [...] })`.
 *
 * ```ts
 * @module({
 *   prefix: "/admin",
 *   use: [authenticate],
 *   controllers: [UsersController, RolesController],
 *   modules: [BillingModule],
 * })
 * class AdminModule {}
 * ```
 *
 * @param options - module configuration (prefix, controllers, nested modules, cross-cutting concerns)
 * @returns a class decorator that records the module's metadata
 */
export function module(options: ModuleOptions = {}) {
  return (_value: Ctor, context: ClassDecoratorContext): void => {
    ctxMeta(context)[MODULE] = options
  }
}
