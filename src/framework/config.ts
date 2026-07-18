import { inject, injectable, InjectionToken, injectOptional } from "./di";
import { ctxMeta, type Ctor, PROFILE } from "./metadata";

/** A source of configuration values keyed by string (env vars, a file, an object). */
export interface ConfigSource {
  get(key: string): string | undefined;
}

/** The default source: `Bun.env` / `process.env`. */
export class EnvConfigSource implements ConfigSource {
  get(key: string): string | undefined {
    return (Bun.env as Record<string, string | undefined>)[key];
  }
}

const ENV_SOURCE = new EnvConfigSource();
const NO_PROFILES: readonly string[] = Object.freeze([]);

/** Override the config source, e.g. `{ provide: CONFIG_SOURCE, useValue: {...} }`. */
export const CONFIG_SOURCE = new InjectionToken<ConfigSource>("ConfigSource");
/** The active profiles (set by `createApp({ profiles })`). */
export const ACTIVE_PROFILES = new InjectionToken<readonly string[]>("ActiveProfiles");

/**
 * Typed access to configuration. Inject it, or use the {@link value} helper.
 * Reads from `Bun.env` by default; override with a `CONFIG_SOURCE` provider or
 * `createApp({ config })`.
 */
@injectable()
export class Config {
  private readonly source = injectOptional(CONFIG_SOURCE, ENV_SOURCE);
  /** Profiles active for this app (see `@profile` and `hasProfile`). */
  readonly profiles = injectOptional(ACTIVE_PROFILES, NO_PROFILES);

  /** Read a value, coercing to the fallback's type (string/number/boolean). */
  get(key: string): string | undefined;
  get(key: string, fallback: number): number;
  get(key: string, fallback: boolean): boolean;
  get(key: string, fallback: string): string;
  get(
    key: string,
    fallback?: string | number | boolean
  ): string | number | boolean | undefined {
    const raw = this.source.get(key);
    if (raw === undefined) return fallback;
    if (typeof fallback === "number") {
      const n = Number(raw);
      return Number.isNaN(n) ? fallback : n;
    }
    if (typeof fallback === "boolean") {
      return raw === "true" || raw === "1";
    }
    return raw;
  }

  /** Read a value, throwing if it is missing. */
  require(key: string): string {
    const raw = this.source.get(key);
    if (raw === undefined) throw new Error(`Missing required config value: ${key}`);
    return raw;
  }

  /** Whether a key is present. */
  has(key: string): boolean {
    return this.source.get(key) !== undefined;
  }

  /** Whether a profile is active. */
  hasProfile(name: string): boolean {
    return this.profiles.includes(name);
  }
}

/**
 * Read a config value in a field initializer, coercing to the fallback's type.
 *
 * ```ts
 * class Server {
 *   private port = value("PORT", 3000);      // number
 *   private debug = value("DEBUG", false);   // boolean
 * }
 * ```
 */
export function value(key: string): string | undefined;
export function value(key: string, fallback: number): number;
export function value(key: string, fallback: boolean): boolean;
export function value(key: string, fallback: string): string;
export function value(
  key: string,
  fallback?: string | number | boolean
): string | number | boolean | undefined {
  const cfg = inject(Config);
  return fallback === undefined ? cfg.get(key) : cfg.get(key, fallback as string);
}

/** Read a required config value in a field initializer (throws if missing). */
export function requireValue(key: string): string {
  return inject(Config).require(key);
}

/**
 * Class decorator: mount this controller/module only when one of `names` is an
 * active profile (see `createApp({ profiles })`). No `@profile` = always mounted.
 *
 * ```ts
 * @profile("dev") @controller("/debug") class DebugController {}
 * ```
 */
export function profile(...names: string[]) {
  return (_value: Ctor, context: ClassDecoratorContext): void => {
    ctxMeta(context)[PROFILE] = names;
  };
}
