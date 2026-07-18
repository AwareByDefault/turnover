import { AsyncLocalStorage } from "node:async_hooks";
import type { Principal } from "./auth";

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
  readonly req: Request;
  principal: Principal | null;
  /** Per-request values populated by derivers; also exposed as `ctx.store`. */
  store: RequestStore;
}

const storage = new AsyncLocalStorage<RequestState>();

/** Run `fn` with `state` bound to the async context (propagates across await). */
export function runInRequest<T>(state: RequestState, fn: () => T): T {
  return storage.run(state, fn);
}

/** The current request's state, or undefined if called outside a request. */
export function getRequestState(): RequestState | undefined {
  return storage.getStore();
}

/**
 * The current request's derived store, or `undefined` outside a request. Handy
 * for injected singletons that need per-request context without a `ctx`.
 */
export function getRequestStore(): RequestStore | undefined {
  return storage.getStore()?.store;
}

/** Attach the authenticated principal to the current request (called by guards). */
export function setPrincipal(principal: Principal): void {
  const state = storage.getStore();
  if (!state) {
    throw new Error("setPrincipal() was called outside a request context.");
  }
  state.principal = principal;
}
