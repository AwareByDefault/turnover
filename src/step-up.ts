import type { Guard } from './http'
import { Session } from './session'

// Session keys these helpers own. Namespaced to avoid clashing with app data.
const STEP_UP_KEY = '__stepUpAt'
const IMPERSONATION_KEY = '__impersonation'

/** Who is acting as whom during impersonation. */
export interface Impersonation {
  /** The real actor (e.g. an admin's id). */
  actor: string
  /** The user being impersonated. */
  target: string
}

/**
 * Mark the current session as freshly re-authenticated (a "step up") — call
 * right after the user re-enters a password or completes MFA for a sensitive
 * action. Requires the `session()` plugin.
 */
export function elevate(session: Session, at: number = Date.now()): void {
  session.set(STEP_UP_KEY, at)
}

/** Clear a session's step-up marker. */
export function clearElevation(session: Session): void {
  session.delete(STEP_UP_KEY)
}

/** Milliseconds since the session was last elevated, or `undefined` if never. */
export function elevationAge(
  session: Session,
  now: number = Date.now(),
): number | undefined {
  const at = session.get<number>(STEP_UP_KEY)
  return at === undefined ? undefined : now - at
}

/**
 * Guard: require the session to have been elevated within `within` ms, else
 * reply `401` — the way to gate a sensitive route behind recent re-authentication
 * (step-up). Pairs with {@link elevate} and the `session()` plugin.
 *
 * ```ts
 * @post('/settings/delete-account')
 * @use(requireStepUp({ within: 5 * 60_000 })) // re-auth within 5 minutes
 * deleteAccount() {}
 * ```
 */
export function requireStepUp(options: {
  /** Maximum age of the step-up, in ms. */
  within: number
  /** Clock source (default `Date.now`). */
  clock?: () => number
  /** Status for a missing/stale step-up (default 401). */
  status?: number
}): Guard {
  const clock = options.clock ?? Date.now
  const status = options.status ?? 401
  return () => {
    const age = elevationAge(new Session(), clock())
    if (age === undefined || age > options.within) {
      return new Response('Step-up authentication required', { status })
    }
  }
}

/**
 * Begin impersonation: record that `actor` is acting as `target` on the current
 * session. Keep the actor's own identity for audit and reversal. Requires the
 * `session()` plugin.
 */
export function impersonate(
  session: Session,
  impersonation: Impersonation,
): void {
  session.set(IMPERSONATION_KEY, impersonation)
}

/** The active impersonation on a session, or `undefined`. */
export function getImpersonation(session: Session): Impersonation | undefined {
  return session.get<Impersonation>(IMPERSONATION_KEY)
}

/** End impersonation, reverting to the actor's own identity. */
export function stopImpersonation(session: Session): void {
  session.delete(IMPERSONATION_KEY)
}
