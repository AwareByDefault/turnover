import { type Ctor, ctxMeta, metadataOf, SCOPE } from "./metadata";

export type Scope = "singleton" | "transient";

// The container that is currently constructing an instance. `inject()` reads it.
let active: Container | null = null;

/**
 * A minimal dependency-injection container.
 *
 * Resolution is by class token: `container.resolve(UserService)` constructs a
 * `UserService`, wiring any `inject()` calls in its field initializers or
 * constructor from the same container. Singletons are cached.
 */
export class Container {
  private readonly singletons = new Map<Ctor, unknown>();
  private readonly resolving = new Set<Ctor>();

  resolve<T>(token: Ctor<T>): T {
    const scope = (metadataOf(token)?.[SCOPE] as Scope | undefined) ?? "singleton";

    if (scope === "singleton") {
      const cached = this.singletons.get(token);
      if (cached !== undefined) return cached as T;
    }
    if (this.resolving.has(token)) {
      throw new Error(
        `Circular dependency while resolving ${token.name}. ` +
          `Break the cycle, or resolve one side lazily inside a method.`
      );
    }

    this.resolving.add(token);
    const previous = active;
    active = this;
    try {
      const instance = new token();
      if (scope === "singleton") this.singletons.set(token, instance);
      return instance;
    } finally {
      active = previous;
      this.resolving.delete(token);
    }
  }
}

/**
 * Resolve a dependency from the container that is currently constructing this
 * object. Call it in a field initializer or constructor of a class the container
 * instantiates (an `@injectable` service or a `@controller`).
 *
 * ```ts
 * class UserController {
 *   private users = inject(UserService);
 * }
 * ```
 */
export function inject<T>(token: Ctor<T>): T {
  if (!active) {
    throw new Error(
      `inject(${token.name}) was called outside an injection context. ` +
        `inject() only works while the container constructs an @injectable/@controller — ` +
        `use it in a field initializer or constructor, not at module top level.`
    );
  }
  return active.resolve(token);
}

/** Mark a class as injectable, optionally setting its scope (default singleton). */
export function injectable(options: { scope?: Scope } = {}) {
  return (_value: Ctor, context: ClassDecoratorContext): void => {
    ctxMeta(context)[SCOPE] = options.scope ?? "singleton";
  };
}
