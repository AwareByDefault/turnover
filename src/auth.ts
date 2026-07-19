import { injectable } from './di'
import type { Guard } from './http'
import { getRequestState } from './request'

/**
 * The authenticated principal for the current request.
 *
 * Intentionally empty — augment it in your app to describe your user:
 *
 * ```ts
 * declare module "<path-to>/framework/auth" {
 *   interface Principal { id: string; roles: string[] }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmentation target for apps
export interface Principal {}

/**
 * Request-scoped auth accessor.
 *
 * It's a singleton, but every getter reads the *current* request's principal
 * from AsyncLocalStorage — so injecting it into a singleton controller still
 * yields per-request data.
 */
@injectable()
export class Auth {
  /** The principal, or throw `401` if the request isn't authenticated. */
  get user(): Principal {
    const principal = getRequestState()?.principal
    if (!principal) throw new Response('Unauthorized', { status: 401 })
    return principal
  }

  /** The principal, or `null` if unauthenticated. */
  get optional(): Principal | null {
    return getRequestState()?.principal ?? null
  }

  get isAuthenticated(): boolean {
    return getRequestState()?.principal != null
  }
}

/** Guard that rejects with `401` unless a principal has been set. */
export const requireAuth: Guard = () => {
  if (!getRequestState()?.principal) {
    return new Response('Unauthorized', { status: 401 })
  }
}
