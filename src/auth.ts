import { injectable } from './di'
import { type Context, type Guard, use } from './http'
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
  /**
   * The current request's principal, or throw a bare `401` `Response` (which
   * passes through the pipeline unchanged) when unauthenticated. Use
   * {@link Auth.optional} to branch instead of throw.
   */
  get user(): Principal {
    const principal = getRequestState()?.principal
    if (!principal) throw new Response('Unauthorized', { status: 401 })
    return principal
  }

  /** The current request's principal, or `null` if unauthenticated; never throws, unlike {@link Auth.user}. */
  get optional(): Principal | null {
    return getRequestState()?.principal ?? null
  }

  /** Whether the current request carries a principal. */
  get isAuthenticated(): boolean {
    return getRequestState()?.principal != null
  }
}

/**
 * Guard rejecting with a bare `401` `Response` unless the request already
 * carries a principal — one set earlier by an `authentication()` scheme or a
 * guard calling `setPrincipal`. It only checks presence; use {@link requireRole}
 * / {@link requireScope} / {@link authorize} for claim or policy checks.
 */
export const requireAuth: Guard = () => {
  if (!getRequestState()?.principal) {
    return new Response('Unauthorized', { status: 401 })
  }
}

/**
 * Decorator (class or method): require an authenticated principal, else `401`.
 * Sugar for `@use(requireAuth)`.
 *
 * ```ts
 * @get('/me') @authenticated me() { return inject(Auth).user }
 * ```
 */
export const authenticated = use(requireAuth)

/** 401 if unauthenticated; 403 if the principal holds none of `allowed`. */
function claimGuard(field: 'roles' | 'scopes', allowed: string[]): Guard {
  return () => {
    const principal = getRequestState()?.principal as
      | Record<string, unknown>
      | null
      | undefined
    if (!principal) return new Response('Unauthorized', { status: 401 })
    const held = principal[field]
    const ok =
      Array.isArray(held) &&
      held.some((value) => allowed.includes(String(value)))
    if (!ok) return new Response('Forbidden', { status: 403 })
  }
}

/**
 * Decorator (class or method): require the principal to hold at least one of
 * `roles` (on `principal.roles`), else `403` — or `401` if unauthenticated.
 *
 * ```ts
 * @controller('/admin') @requireRole('admin')
 * class Admin { @get('/') list() {} }
 * ```
 *
 * @param roles - claim values; the principal must hold at least one on `principal.roles`
 * @returns a class/method guard decorator that enforces the role check
 */
export function requireRole(...roles: string[]) {
  return use(claimGuard('roles', roles))
}

/**
 * Like {@link requireRole}, but checks `principal.scopes`.
 *
 * @param scopes - claim values; the principal must hold at least one on `principal.scopes`
 * @returns a class/method guard decorator that enforces the scope check
 */
export function requireScope(...scopes: string[]) {
  return use(claimGuard('scopes', scopes))
}

/**
 * Decorator (class or method): allow the request only when `policy` returns
 * truthy for the current principal — the generic escape hatch for ownership,
 * tenancy, or any custom rule. `401` if unauthenticated, `403` if it rejects.
 *
 * ```ts
 * @del('/:id') @authorize((user, ctx) => user.id === ctx.params.id)
 * remove() {}
 * ```
 *
 * @param policy - predicate over the current principal and request context; truthy allows the request
 * @returns a class/method guard decorator that enforces the policy
 */
export function authorize(
  policy: (principal: Principal, ctx: Context) => boolean | Promise<boolean>,
) {
  const guard: Guard = async (ctx) => {
    const principal = getRequestState()?.principal
    if (!principal) return new Response('Unauthorized', { status: 401 })
    if (!(await policy(principal, ctx))) {
      return new Response('Forbidden', { status: 403 })
    }
  }
  return use(guard)
}
