import { AsyncLocalStorage } from "node:async_hooks";
import type { Principal } from "./auth";

/** State bound to the current request for the duration of its handling. */
export interface RequestState {
  readonly req: Request;
  principal: Principal | null;
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

/** Attach the authenticated principal to the current request (called by guards). */
export function setPrincipal(principal: Principal): void {
  const state = storage.getStore();
  if (!state) {
    throw new Error("setPrincipal() was called outside a request context.");
  }
  state.principal = principal;
}
