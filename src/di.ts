import {
  type Ctor,
  ctxMeta,
  metadataOf,
  POST_CONSTRUCT,
  PRE_DESTROY,
  REPOSITORY,
  SCOPE,
} from './metadata'
import { getRequestState } from './request'

export type Scope = 'singleton' | 'transient' | 'request'

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
  declare readonly _type: T
  constructor(readonly description: string) {}
  toString(): string {
    return `InjectionToken<${this.description}>`
  }
}

/** Anything that can be resolved: a class, or an {@link InjectionToken}. */
export type Token<T = unknown> = Ctor<T> | InjectionToken<T>

/** How a token is provided when resolved. */
export type Provider<T> =
  | { useValue: T }
  | { useClass: Ctor<T>; scope?: Scope }
  | { useFactory: (container: Container) => T; scope?: Scope }
  | { useExisting: Token<T> }

/** A provider paired with the token it provides (for `createApp({ providers })`). */
export type ProviderDef<T = unknown> = { provide: Token<T> } & Provider<T>

/**
 * Inspects each freshly constructed class instance and returns the instance to
 * use — the same object, or a wrapper (e.g. a `Proxy`). This is the seam that
 * method-level AOP (advice) is built on. Processors chain in registration order.
 */
export type PostProcessor = (instance: object, token: Ctor) => object

/** A readable name for a token, for error messages. */
function describe(token: Token): string {
  return typeof token === 'function' ? token.name : String(token)
}

// The container that is currently constructing an instance. `inject()` reads it.
let active: Container | null = null

/**
 * A dependency-injection container.
 *
 * A class token auto-constructs (`container.resolve(UserService)` runs
 * `new UserService()`, wiring any `inject()` in its field initializers). Bind a
 * token to a value/class/factory/alias with `register()`; the last registration
 * for a token wins for `resolve()`, while `resolveAll()` returns them all.
 */
export class Container {
  private readonly classSingletons = new Map<Ctor, unknown>()
  private readonly factorySingletons = new Map<object, unknown>()
  private readonly providers = new Map<Token, Provider<unknown>[]>()
  private readonly resolving = new Set<Ctor>()
  // Promises returned by async `@postConstruct` hooks, awaited by `init()`.
  private readonly initPromises: Promise<unknown>[] = []
  // Instances with `@preDestroy` hooks, run in reverse order by `dispose()`.
  private readonly disposables: Array<{
    instance: object
    methods: PropertyKey[]
  }> = []
  // Hooks that wrap/replace each constructed instance (the AOP seam).
  private readonly postProcessors: PostProcessor[] = []

  /** Register a hook that can wrap/replace each constructed instance. */
  addPostProcessor(processor: PostProcessor): this {
    this.postProcessors.push(processor)
    return this
  }

  /** Run `fn` with this container active, so `inject()` works inside it. */
  runInContext<T>(fn: () => T): T {
    const previous = active
    active = this
    try {
      return fn()
    } finally {
      active = previous
    }
  }

  /** Bind `provider` to `token`. Repeated calls stack (see `resolveAll`). */
  register<T>(token: Token<T>, provider: Provider<T>): this {
    const list = this.providers.get(token) ?? []
    list.push(provider as Provider<unknown>)
    this.providers.set(token, list)
    return this
  }

  /** Resolve a token. A registered provider wins; otherwise a class is constructed. */
  resolve<T>(token: Token<T>): T {
    const bindings = this.providers.get(token)
    if (bindings && bindings.length > 0) {
      // Last registration wins — lets a test/override shadow an earlier binding.
      return this.fromProvider(bindings[bindings.length - 1] as Provider<T>)
    }
    if (typeof token === 'function') return this.construct(token)
    throw new Error(
      `No provider registered for ${describe(token)}. Bind one with ` +
        `container.register(...) or createApp({ providers: [...] }).`,
    )
  }

  /** Resolve every provider bound to a token (for multi-injection). */
  resolveAll<T>(token: Token<T>): T[] {
    const bindings = this.providers.get(token)
    if (bindings && bindings.length > 0) {
      return bindings.map((b) => this.fromProvider(b as Provider<T>))
    }
    if (typeof token === 'function') return [this.construct(token)]
    return []
  }

  /** Resolve a token, or return `fallback` if an InjectionToken is unbound. */
  resolveOptional<T>(token: Token<T>, fallback: T): T {
    const bindings = this.providers.get(token)
    if (bindings && bindings.length > 0) {
      return this.fromProvider(bindings[bindings.length - 1] as Provider<T>)
    }
    if (typeof token === 'function') return this.construct(token)
    return fallback
  }

  private fromProvider<T>(provider: Provider<T>): T {
    if ('useValue' in provider) return provider.useValue
    if ('useExisting' in provider) return this.resolve(provider.useExisting)
    if ('useClass' in provider)
      return this.construct(provider.useClass, provider.scope)

    const scope = provider.scope ?? 'singleton'
    if (scope === 'singleton' && this.factorySingletons.has(provider)) {
      return this.factorySingletons.get(provider) as T
    }
    const previous = active
    active = this
    try {
      const value = provider.useFactory(this)
      if (scope === 'singleton') this.factorySingletons.set(provider, value)
      return value
    } finally {
      active = previous
    }
  }

  private construct<T>(token: Ctor<T>, scopeOverride?: Scope): T {
    const scope =
      scopeOverride ??
      (metadataOf(token)?.[SCOPE] as Scope | undefined) ??
      'singleton'

    // Request scope: return a proxy that resolves the current request's instance,
    // so it works even when injected into a longer-lived (singleton) bean.
    if (scope === 'request') return this.requestScopedProxy(token)

    if (scope === 'singleton') {
      const cached = this.classSingletons.get(token)
      if (cached !== undefined) return cached as T
    }
    if (this.resolving.has(token)) {
      throw new Error(
        `Circular dependency while resolving ${token.name}. ` +
          `Break the cycle, or resolve one side lazily inside a method.`,
      )
    }

    this.resolving.add(token)
    const previous = active
    active = this
    try {
      const instance = new token() as object
      // Cache the raw instance first so re-entrant resolution during
      // construction/init doesn't loop — and so self-invocation reaches the
      // unwrapped object.
      if (scope === 'singleton') this.classSingletons.set(token, instance)
      this.runLifecycle(instance, token, scope)

      let result = instance
      for (const processor of this.postProcessors)
        result = processor(result, token)
      if (scope === 'singleton' && result !== instance) {
        this.classSingletons.set(token, result) // cache the wrapper
      }
      return result as T
    } finally {
      active = previous
      this.resolving.delete(token)
    }
  }

  /** A proxy delegating to the current request's instance of a request-scoped bean. */
  private requestScopedProxy<T>(token: Ctor<T>): T {
    const container = this
    return new Proxy(Object.create(null), {
      get(_target, prop) {
        const instance = container.currentRequestInstance(token) as Record<
          PropertyKey,
          unknown
        >
        const value = instance[prop]
        return typeof value === 'function' ? value.bind(instance) : value
      },
      set(_target, prop, value) {
        const instance = container.currentRequestInstance(token) as Record<
          PropertyKey,
          unknown
        >
        instance[prop] = value
        return true
      },
      has(_target, prop) {
        return prop in (container.currentRequestInstance(token) as object)
      },
    }) as T
  }

  /** The current request's instance of a request-scoped bean (built + cached once). */
  private currentRequestInstance<T>(token: Ctor<T>): T {
    const state = getRequestState()
    // Outside a request there is nowhere to cache — build a fresh one.
    if (!state) return this.construct(token, 'transient')
    let instance = state.scopeCache.get(token) as T | undefined
    if (instance === undefined) {
      instance = this.construct(token, 'transient')
      state.scopeCache.set(token, instance)
    }
    return instance
  }

  /**
   * Run `@postConstruct` and track `@preDestroy`. App-level tracking (awaiting
   * async init at bootstrap, disposing at shutdown) applies only to singletons —
   * transient/request beans are short-lived, so tracking them would leak.
   */
  private runLifecycle(instance: object, token: Ctor, scope: Scope): void {
    const bag = metadataOf(token)
    const postConstructs = bag?.[POST_CONSTRUCT] as PropertyKey[] | undefined
    if (postConstructs) {
      const methods = instance as Record<PropertyKey, () => unknown>
      for (const name of postConstructs) {
        const method = methods[name]
        if (typeof method !== 'function') continue
        const result = method.call(instance)
        if (result instanceof Promise && scope === 'singleton') {
          this.initPromises.push(result)
        }
      }
    }
    const preDestroys = bag?.[PRE_DESTROY] as PropertyKey[] | undefined
    if (preDestroys && scope === 'singleton') {
      this.disposables.push({ instance, methods: preDestroys })
    }
  }

  /** Await all async `@postConstruct` hooks run so far (called by `createApp`). */
  async init(): Promise<void> {
    while (this.initPromises.length > 0) {
      await Promise.all(this.initPromises.splice(0))
    }
  }

  /** Run every `@preDestroy` hook in reverse construction order (called by `app.stop`). */
  async dispose(): Promise<void> {
    const disposables = this.disposables.splice(0).reverse()
    for (const { instance, methods } of disposables) {
      const target = instance as Record<PropertyKey, () => unknown>
      for (const name of methods) {
        const method = target[name]
        if (typeof method !== 'function') continue
        try {
          await method.call(instance)
        } catch (err) {
          console.error('[turnover] @preDestroy hook failed:', err)
        }
      }
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
        `use it in a field initializer or constructor, not at module top level.`,
    )
  }
  return active.resolve(token)
}

/** Like {@link inject}, but resolves every provider bound to a token. */
export function injectAll<T>(token: Token<T>): T[] {
  if (!active) {
    throw new Error(
      `injectAll(${describe(token)}) was called outside an injection context.`,
    )
  }
  return active.resolveAll(token)
}

/** Like {@link inject}, but returns `fallback` when an InjectionToken is unbound. */
export function injectOptional<T>(token: Token<T>, fallback: T): T {
  if (!active) {
    throw new Error(
      `injectOptional(${describe(token)}) was called outside an injection context.`,
    )
  }
  return active.resolveOptional(token, fallback)
}

/** Mark a class as injectable, optionally setting its scope (default singleton). */
export function injectable(options: { scope?: Scope } = {}) {
  return (_value: Ctor, context: ClassDecoratorContext): void => {
    ctxMeta(context)[SCOPE] = options.scope ?? 'singleton'
  }
}

/** Stereotype alias for `@injectable` — marks a service-layer component. */
export const service = injectable

/**
 * Stereotype for a persistence/DAO component. Like `@injectable`, but every one
 * of the class's own methods additionally runs inside the bound
 * `TransactionManager` (as if each were `@transactional`) — annotating the
 * intent earns the unit-of-work behavior. With no manager bound it is a no-op.
 */
export function repository(options: { scope?: Scope } = {}) {
  return (_value: Ctor, context: ClassDecoratorContext): void => {
    ctxMeta(context)[SCOPE] = options.scope ?? 'singleton'
    ctxMeta(context)[REPOSITORY] = true
  }
}

/**
 * Method decorator: run this method right after the container constructs the
 * instance (once field initializers have run). Sync hooks run inline; async
 * hooks are awaited at bootstrap via `container.init()` (which `createApp`
 * calls). Use it for per-service setup (open a pool, warm a cache).
 */
export function postConstruct(
  _value: unknown,
  context: ClassMethodDecoratorContext,
): void {
  const meta = ctxMeta(context)
  const list = (meta[POST_CONSTRUCT] as PropertyKey[] | undefined) ?? []
  list.push(context.name)
  meta[POST_CONSTRUCT] = list
}

/**
 * Method decorator: run this method when the app is stopped (`app.stop()` calls
 * `container.dispose()`), in reverse construction order. Use it to release
 * resources (close connections, flush buffers).
 */
export function preDestroy(
  _value: unknown,
  context: ClassMethodDecoratorContext,
): void {
  const meta = ctxMeta(context)
  const list = (meta[PRE_DESTROY] as PropertyKey[] | undefined) ?? []
  list.push(context.name)
  meta[PRE_DESTROY] = list
}
