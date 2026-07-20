import { AsyncLocalStorage } from 'node:async_hooks'
import type { Principal } from './auth'

/**
 * Arbitrary per-request values populated by `@derive` handlers (and readable via
 * `ctx.store`). Intentionally empty — augment it in your app to describe what
 * your derivers add:
 *
 * ```ts
 * declare module "<path-to>/framework/request" {
 *   interface RequestStore { session: Session; tenantId: string }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmentation target for apps
export interface RequestStore {}

/** State bound to the current request for the duration of its handling. */
export interface RequestState {
  /** The incoming request. */
  readonly req: Request
  /** The authenticated principal, or `null` until a guard sets it. */
  principal: Principal | null
  /** Correlation id for this request (set by the `requestId()` plugin). */
  requestId?: string
  /** Per-request values populated by derivers; also exposed as `ctx.store`. */
  store: RequestStore
  /** Cache of `scope: "request"` instances, one set per request. */
  readonly scopeCache: Map<import('./metadata').Ctor, unknown>
}

const storage = new AsyncLocalStorage<RequestState>()

/**
 * Run `fn` with `state` bound to the async context (propagates across await).
 *
 * @typeParam T - The return type of `fn`.
 * @param state - The request state to bind for the duration of `fn`.
 * @param fn - The function to run within the bound request context.
 * @returns Whatever `fn` returns.
 */
export function runInRequest<T>(state: RequestState, fn: () => T): T {
  return storage.run(state, fn)
}

/**
 * The current request's state, or undefined if called outside a request.
 *
 * @returns The active request's state, or `undefined` outside a request.
 */
export function getRequestState(): RequestState | undefined {
  return storage.getStore()
}

/**
 * The current request's derived store, or `undefined` outside a request. Handy
 * for injected singletons that need per-request context without a `ctx`.
 *
 * @returns The current request's derived store, or `undefined` outside a request.
 */
export function getRequestStore(): RequestStore | undefined {
  return storage.getStore()?.store
}

/**
 * Attach the authenticated principal to the current request (called by guards).
 *
 * @param principal - The authenticated principal to bind to the request.
 */
export function setPrincipal(principal: Principal): void {
  const state = storage.getStore()
  if (!state) {
    throw new Error('setPrincipal() was called outside a request context.')
  }
  state.principal = principal
}

/**
 * The current request's correlation id, or `undefined` outside a request.
 *
 * @returns The current request's correlation id, or `undefined` outside a request.
 */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId
}

/**
 * Set the current request's correlation id (called by the `requestId()` plugin).
 *
 * @param id - The correlation id to store on the current request.
 */
export function setRequestId(id: string): void {
  const state = storage.getStore()
  if (state) state.requestId = id
}
