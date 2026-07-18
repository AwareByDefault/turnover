import { type Container, injectable, type PostProcessor } from "./di";
import { ctxMeta, type Ctor, EVENT_LISTENERS, metadataOf } from "./metadata";

/** An event class — used both to subscribe and (via `event.constructor`) to dispatch. */
// biome-ignore lint/suspicious/noExplicitAny: any event class, concrete or abstract
export type EventType<E extends object = object> = abstract new (...args: any[]) => E;

/** A subscriber to an event. */
export type EventListener<E> = (event: E) => unknown;

/**
 * An in-process publish/subscribe bus. Inject it, `publish()` events, and
 * subscribe with `on()` or the `@onEvent` decorator. `publish` awaits all
 * listeners (a failing one is logged, not propagated).
 */
@injectable()
export class Events {
  private readonly listeners = new Map<EventType, Set<EventListener<object>>>();

  /** Subscribe to an event type. Returns an unsubscribe function. */
  on<E extends object>(type: EventType<E>, listener: EventListener<E>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as EventListener<object>);
    return () => set?.delete(listener as EventListener<object>);
  }

  /** Publish an event to every subscriber of its class; resolves when all finish. */
  async publish<E extends object>(event: E): Promise<void> {
    const set = this.listeners.get(event.constructor as EventType);
    if (!set || set.size === 0) return;
    // Wrap in an async mapper so a synchronous throw becomes a settled rejection.
    const results = await Promise.allSettled(
      [...set].map(async (listener) => listener(event))
    );
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("[turnover] event listener failed:", result.reason);
      }
    }
  }
}

interface EventListenerMeta {
  type: EventType;
  method: PropertyKey;
}

/**
 * Method decorator: subscribe this method to an event type. The service is
 * registered when it is constructed (inject it, or list it in
 * `createApp({ listeners })` to construct it eagerly).
 *
 * ```ts
 * @injectable() class Emailer {
 *   @onEvent(UserCreated) welcome(e: UserCreated) { ... }
 * }
 * ```
 */
export function onEvent<E extends object>(type: EventType<E>) {
  return (_value: unknown, context: ClassMethodDecoratorContext): void => {
    const meta = ctxMeta(context);
    const list = (meta[EVENT_LISTENERS] as EventListenerMeta[] | undefined) ?? [];
    list.push({ type, method: context.name });
    meta[EVENT_LISTENERS] = list;
  };
}

/**
 * A post-processor that subscribes a constructed instance's `@onEvent` methods
 * to the container's `Events` bus. Registered automatically by `createApp`.
 */
export function eventListenerProcessor(container: Container): PostProcessor {
  return (instance, token: Ctor) => {
    const listeners = metadataOf(token)?.[EVENT_LISTENERS] as
      | EventListenerMeta[]
      | undefined;
    if (listeners && listeners.length > 0) {
      const bus = container.resolve(Events);
      const methods = instance as Record<PropertyKey, (event: object) => unknown>;
      for (const { type, method } of listeners) {
        bus.on(type, (event) => methods[method](event));
      }
    }
    return instance;
  };
}
