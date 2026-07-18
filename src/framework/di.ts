import { type Ctor, ctxMeta, metadataOf, SCOPE } from "./metadata";

export type Scope = "singleton" | "transient";

/**
 * A token for a non-class dependency (an interface, a config value, a service
 * with several implementations). Bind it with `container.register(TOKEN, ...)`
 * and read it with `inject(TOKEN)`.
 *
 * ```ts
 * const LOGGER = new InjectionToken<Logger>("Logger");
 * ```
 */
export class InjectionToken<T> {
  // Phantom, erased at runtime — carries the resolved type for `inject`.
  declare readonly _type: T;
  constructor(readonly description: string) {}
  toString(): string {
    return `InjectionToken<${this.description}>`;
  }
}

/** Anything that can be resolved: a class, or an {@link InjectionToken}. */
export type Token<T = unknown> = Ctor<T> | InjectionToken<T>;

/** How a token is provided when resolved. */
export type Provider<T> =
  | { useValue: T }
  | { useClass: Ctor<T>; scope?: Scope }
  | { useFactory: (container: Container) => T; scope?: Scope }
  | { useExisting: Token<T> };

/** A provider paired with the token it provides (for `createApp({ providers })`). */
export type ProviderDef<T = unknown> = { provide: Token<T> } & Provider<T>;

/** A readable name for a token, for error messages. */
function describe(token: Token): string {
  return typeof token === "function" ? token.name : String(token);
}

// The container that is currently constructing an instance. `inject()` reads it.
let active: Container | null = null;

/**
 * A dependency-injection container.
 *
 * A class token auto-constructs (`container.resolve(UserService)` runs
 * `new UserService()`, wiring any `inject()` in its field initializers). Bind a
 * token to a value/class/factory/alias with `register()`; the last registration
 * for a token wins for `resolve()`, while `resolveAll()` returns them all.
 */
export class Container {
  private readonly classSingletons = new Map<Ctor, unknown>();
  private readonly factorySingletons = new Map<object, unknown>();
  private readonly providers = new Map<Token, Provider<unknown>[]>();
  private readonly resolving = new Set<Ctor>();

  /** Bind `provider` to `token`. Repeated calls stack (see `resolveAll`). */
  register<T>(token: Token<T>, provider: Provider<T>): this {
    const list = this.providers.get(token) ?? [];
    list.push(provider as Provider<unknown>);
    this.providers.set(token, list);
    return this;
  }

  /** Resolve a token. A registered provider wins; otherwise a class is constructed. */
  resolve<T>(token: Token<T>): T {
    const bindings = this.providers.get(token);
    if (bindings && bindings.length > 0) {
      // Last registration wins — lets a test/override shadow an earlier binding.
      return this.fromProvider(bindings[bindings.length - 1] as Provider<T>);
    }
    if (typeof token === "function") return this.construct(token);
    throw new Error(
      `No provider registered for ${describe(token)}. Bind one with ` +
        `container.register(...) or createApp({ providers: [...] }).`
    );
  }

  /** Resolve every provider bound to a token (for multi-injection). */
  resolveAll<T>(token: Token<T>): T[] {
    const bindings = this.providers.get(token);
    if (bindings && bindings.length > 0) {
      return bindings.map((b) => this.fromProvider(b as Provider<T>));
    }
    if (typeof token === "function") return [this.construct(token)];
    return [];
  }

  private fromProvider<T>(provider: Provider<T>): T {
    if ("useValue" in provider) return provider.useValue;
    if ("useExisting" in provider) return this.resolve(provider.useExisting);
    if ("useClass" in provider) return this.construct(provider.useClass, provider.scope);

    const scope = provider.scope ?? "singleton";
    if (scope === "singleton" && this.factorySingletons.has(provider)) {
      return this.factorySingletons.get(provider) as T;
    }
    const previous = active;
    active = this;
    try {
      const value = provider.useFactory(this);
      if (scope === "singleton") this.factorySingletons.set(provider, value);
      return value;
    } finally {
      active = previous;
    }
  }

  private construct<T>(token: Ctor<T>, scopeOverride?: Scope): T {
    const scope =
      scopeOverride ?? (metadataOf(token)?.[SCOPE] as Scope | undefined) ?? "singleton";

    if (scope === "singleton") {
      const cached = this.classSingletons.get(token);
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
      if (scope === "singleton") this.classSingletons.set(token, instance);
      return instance;
    } finally {
      active = previous;
      this.resolving.delete(token);
    }
  }
}

/**
 * Resolve a dependency from the container currently constructing this object.
 * Call it in a field initializer or constructor of a class the container
 * instantiates (an `@injectable` service or a `@controller`).
 *
 * ```ts
 * class UserController {
 *   private users = inject(UserService);
 *   private logger = inject(LOGGER); // an InjectionToken
 * }
 * ```
 */
export function inject<T>(token: Token<T>): T {
  if (!active) {
    throw new Error(
      `inject(${describe(token)}) was called outside an injection context. ` +
        `inject() only works while the container constructs an @injectable/@controller — ` +
        `use it in a field initializer or constructor, not at module top level.`
    );
  }
  return active.resolve(token);
}

/** Like {@link inject}, but resolves every provider bound to a token. */
export function injectAll<T>(token: Token<T>): T[] {
  if (!active) {
    throw new Error(
      `injectAll(${describe(token)}) was called outside an injection context.`
    );
  }
  return active.resolveAll(token);
}

/** Mark a class as injectable, optionally setting its scope (default singleton). */
export function injectable(options: { scope?: Scope } = {}) {
  return (_value: Ctor, context: ClassDecoratorContext): void => {
    ctxMeta(context)[SCOPE] = options.scope ?? "singleton";
  };
}
