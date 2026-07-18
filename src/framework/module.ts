import type { Deriver, ErrorHandler, Guard } from "./http";
import { ctxMeta, type Ctor, MODULE } from "./metadata";

/**
 * How a module groups controllers. A module is a mount point: it prepends a
 * `prefix` to its controllers' routes and shares guards/derivers/error handlers
 * with all of them (and with any nested modules).
 */
export interface ModuleOptions {
  /** Path prefix prepended to every route mounted by this module. */
  prefix?: string;
  /** Controllers mounted by this module. */
  controllers?: Ctor[];
  /** Nested modules, mounted under this module's prefix and cross-cutting. */
  modules?: Ctor[];
  /** Guards applied before every route in this module (and nested modules). */
  use?: Guard[];
  /** Derivers run before every route in this module (and nested modules). */
  derive?: Deriver[];
  /** Error handlers for every route in this module (and nested modules). */
  catchError?: ErrorHandler[];
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
 */
export function module(options: ModuleOptions = {}) {
  return (_value: Ctor, context: ClassDecoratorContext): void => {
    ctxMeta(context)[MODULE] = options;
  };
}
