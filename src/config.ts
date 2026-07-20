import { InjectionToken, inject, injectable, injectOptional } from './di'
import { type Ctor, ctxMeta, PROFILE } from './metadata'
import { issuePath, type StandardIssue, type StandardSchemaV1 } from './schema'

/** A source of configuration values keyed by string (env vars, a file, an object). */
export interface ConfigSource {
  /**
   * Read the raw string value for `key`, or `undefined` if absent.
   *
   * @param key - the configuration key to read.
   * @returns the raw string value, or `undefined` if absent.
   */
  get(key: string): string | undefined
  /**
   * All key/value pairs — for consumers that enumerate the whole source, such
   * as {@link configProperties}. Optional; a source that can't enumerate simply
   * won't support `@configProperties` binding.
   *
   * @returns an iterable of every `[key, value]` pair in the source.
   */
  entries?(): Iterable<readonly [string, string]>
}

/** The default source: `Bun.env` / `process.env`. */
export class EnvConfigSource implements ConfigSource {
  /**
   * Read the environment variable named `key`.
   *
   * @param key - the environment variable name to read.
   * @returns the variable's value, or `undefined` if unset.
   */
  get(key: string): string | undefined {
    return (Bun.env as Record<string, string | undefined>)[key]
  }

  /**
   * Every defined environment variable as a `[key, value]` pair.
   *
   * @returns an iterable of `[name, value]` pairs; variables whose value is `undefined` are skipped, so every pair is a real string.
   */
  entries(): Iterable<readonly [string, string]> {
    const env = Bun.env as Record<string, string | undefined>
    return Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    )
  }
}

const ENV_SOURCE = new EnvConfigSource()
const NO_PROFILES: readonly string[] = Object.freeze([])

/** Override the config source, e.g. `{ provide: CONFIG_SOURCE, useValue: {...} }`. */
export const CONFIG_SOURCE = new InjectionToken<ConfigSource>('ConfigSource')
/** The active profiles (set by `createApp({ profiles })`). */
export const ACTIVE_PROFILES = new InjectionToken<readonly string[]>(
  'ActiveProfiles',
)

/**
 * Typed access to configuration. Inject it, or use the {@link value} helper.
 * Reads from `Bun.env` by default; override with a `CONFIG_SOURCE` provider or
 * `createApp({ config })`.
 */
@injectable()
export class Config {
  private readonly source = injectOptional(CONFIG_SOURCE, ENV_SOURCE)
  /** Profiles active for this app (see `@profile` and `hasProfile`). */
  readonly profiles = injectOptional(ACTIVE_PROFILES, NO_PROFILES)

  /**
   * Read a value, coercing to the fallback's type (string/number/boolean).
   *
   * @remarks
   * Coercion is driven by the fallback's runtime type: a `number` fallback parses
   * the raw string with `Number()` and falls back when the result is `NaN`; a
   * `boolean` fallback is `true` only for the exact strings `'true'` or `'1'` (every
   * other value, `'false'` included, yields `false`); a `string` (or absent) fallback
   * returns the raw value unchanged. The source is read fresh on every call.
   *
   * @param key - the configuration key to read.
   * @param fallback - value returned when the key is absent; its type drives coercion (string/number/boolean).
   * @returns the coerced value, or `fallback` (or `undefined` when no fallback is given).
   */
  get(key: string): string | undefined
  get(key: string, fallback: number): number
  get(key: string, fallback: boolean): boolean
  get(key: string, fallback: string): string
  get(
    key: string,
    fallback?: string | number | boolean,
  ): string | number | boolean | undefined {
    const raw = this.source.get(key)
    if (raw === undefined) return fallback
    if (typeof fallback === 'number') {
      const n = Number(raw)
      return Number.isNaN(n) ? fallback : n
    }
    if (typeof fallback === 'boolean') {
      return raw === 'true' || raw === '1'
    }
    return raw
  }

  /**
   * Read a value, throwing if it is missing.
   *
   * @param key - the configuration key to read.
   * @returns the raw string value, never coerced.
   */
  require(key: string): string {
    const raw = this.source.get(key)
    if (raw === undefined)
      throw new Error(`Missing required config value: ${key}`)
    return raw
  }

  /**
   * Whether a key is present.
   *
   * @param key - the configuration key to check.
   * @returns `true` if the key is present.
   */
  has(key: string): boolean {
    return this.source.get(key) !== undefined
  }

  /**
   * Whether a profile is active.
   *
   * @param name - the profile name to check.
   * @returns `true` if the profile is active.
   */
  hasProfile(name: string): boolean {
    return this.profiles.includes(name)
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
 *
 * @param key - the configuration key to read.
 * @param fallback - value returned when the key is absent; its type drives coercion (string/number/boolean).
 * @returns the coerced value, or `fallback` (or `undefined` when no fallback is given).
 */
export function value(key: string): string | undefined
export function value(key: string, fallback: number): number
export function value(key: string, fallback: boolean): boolean
export function value(key: string, fallback: string): string
export function value(
  key: string,
  fallback?: string | number | boolean,
): string | number | boolean | undefined {
  const cfg = inject(Config)
  return fallback === undefined
    ? cfg.get(key)
    : cfg.get(key, fallback as string)
}

/**
 * Read a required config value in a field initializer (throws if missing).
 *
 * @param key - the configuration key to read.
 * @returns the raw string value, never coerced.
 */
export function requireValue(key: string): string {
  return inject(Config).require(key)
}

/**
 * Class decorator: mount this controller/module only when one of `names` is an
 * active profile (see `createApp({ profiles })`). No `@profile` = always mounted.
 *
 * ```ts
 * @profile("dev") @controller("/debug") class DebugController {}
 * ```
 *
 * @param names - profile names that enable this class; it mounts if any one is active.
 * @returns a class decorator that gates mounting on the active profiles.
 */
export function profile(...names: string[]) {
  return (_value: Ctor, context: ClassDecoratorContext): void => {
    ctxMeta(context)[PROFILE] = names
  }
}

/** Options for {@link configProperties}. */
export interface ConfigPropertiesOptions {
  /**
   * Only bind variables whose name starts with this prefix; the prefix is
   * stripped before mapping to a field (e.g. `prefix: "APP_"` binds `APP_PORT`
   * to `port`).
   */
  prefix?: string
}

/** Thrown when configuration fails its schema at construction (fail-fast). */
export class ConfigValidationError extends Error {
  /** The Standard Schema issues that caused the failure. */
  readonly issues: ReadonlyArray<StandardIssue>

  /** Build the error from the offending config class name and its schema issues. */
  constructor(configClass: string, issues: ReadonlyArray<StandardIssue>) {
    const detail = issues
      .map((issue) => {
        const path = issuePath(issue)?.join('.') ?? ''
        return `  - ${path ? `${path}: ` : ''}${issue.message}`
      })
      .join('\n')
    super(`Invalid configuration for ${configClass}:\n${detail}`)
    this.name = 'ConfigValidationError'
    this.issues = issues
  }
}

/** `DATABASE_URL` → `databaseUrl`, `PORT` → `port`. */
function toCamelCase(key: string): string {
  return key
    .toLowerCase()
    .replace(/_+([a-z0-9])/g, (_match, char: string) => char.toUpperCase())
}

/** Read every entry from the source, strip the prefix, and camelCase the keys. */
function collectConfig(
  source: ConfigSource,
  prefix: string,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, val] of source.entries?.() ?? []) {
    if (prefix && !key.startsWith(prefix)) continue
    out[toCamelCase(prefix ? key.slice(prefix.length) : key)] = val
  }
  return out
}

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    value != null && typeof (value as { then?: unknown }).then === 'function'
  )
}

/**
 * Class decorator: bind configuration to a class's fields by naming convention
 * and validate it through a Standard Schema when the class is constructed
 * (fail-fast). Each field's `SCREAMING_SNAKE_CASE` environment variable maps to
 * its `camelCase` name — `DATABASE_URL` → `databaseUrl` — then the whole object
 * is validated (and coerced) by `schema`. The validated result is assigned onto
 * the instance, which is an injectable singleton.
 *
 * ```ts
 * @configProperties(EnvSchema)      // EnvSchema: any Standard Schema (Zod, …)
 * class Settings {
 *   port!: number                   // ← PORT
 *   databaseUrl!: string            // ← DATABASE_URL
 * }
 * // inject(Settings).port  → validated number; boot fails on a bad value
 * ```
 *
 * Reads from `Bun.env` by default; a `CONFIG_SOURCE` provider (or
 * `createApp({ config })`) overrides it, as long as the source can `entries()`.
 * The schema must validate synchronously.
 *
 * @param schema - the Standard Schema that validates (and coerces) the collected config object.
 * @param options - binding options; `prefix` filters variables by name prefix and strips it.
 * @returns a class decorator that replaces the class with a validating subclass.
 */
export function configProperties(
  schema: StandardSchemaV1,
  options: ConfigPropertiesOptions = {},
) {
  return <T extends new () => object>(
    target: T,
    _context: ClassDecoratorContext,
  ): T => {
    const bound = class extends (target as new () => object) {
      constructor() {
        super()
        const source = injectOptional(CONFIG_SOURCE, ENV_SOURCE)
        const raw = collectConfig(source, options.prefix ?? '')
        const result = schema['~standard'].validate(raw)
        if (isThenable(result)) {
          throw new Error(
            `@configProperties on ${target.name} needs a synchronous schema, ` +
              'but the validator returned a promise.',
          )
        }
        if (result.issues) {
          throw new ConfigValidationError(target.name, result.issues)
        }
        Object.assign(this, result.value as object)
      }
    }
    Object.defineProperty(bound, 'name', { value: target.name })
    return bound as unknown as T
  }
}
