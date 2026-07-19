import { InjectionToken, injectable, injectOptional } from './di'

/** Supported password-hashing algorithms (Bun's built-ins). */
export type PasswordAlgorithm = 'argon2id' | 'argon2i' | 'argon2d' | 'bcrypt'

/** Tuning for {@link PasswordHasher}. Omitted fields use Bun's defaults. */
export interface PasswordOptions {
  /** Algorithm to hash with (default `"argon2id"`). Verification auto-detects. */
  algorithm?: PasswordAlgorithm
  /** Argon2 memory cost (KiB). */
  memoryCost?: number
  /** Argon2 iteration count. */
  timeCost?: number
  /** bcrypt cost factor (rounds = 2^cost). */
  cost?: number
}

/** DI token to configure the {@link PasswordHasher} (bind a {@link PasswordOptions}). */
export const PASSWORD_OPTIONS = new InjectionToken<PasswordOptions>(
  'PASSWORD_OPTIONS',
)

type BunHashOptions = Parameters<typeof Bun.password.hash>[1]

/**
 * Injectable password hasher over Bun's native Argon2/bcrypt. A thin, safe home
 * for credential hashing: sensible defaults (Argon2id), configurable cost via
 * the {@link PASSWORD_OPTIONS} token, and a `verify` that returns `false` for a
 * malformed hash instead of throwing.
 *
 * ```ts
 * class Accounts {
 *   private readonly passwords = inject(PasswordHasher)
 *   @post('/register') async register(ctx) {
 *     const { password } = await ctx.body()
 *     await this.repo.save({ hash: await this.passwords.hash(password) })
 *   }
 * }
 * ```
 */
@injectable()
export class PasswordHasher {
  private readonly options = injectOptional<PasswordOptions>(
    PASSWORD_OPTIONS,
    {},
  )

  private bunOptions(): BunHashOptions {
    const { algorithm, memoryCost, timeCost, cost } = this.options
    if (!algorithm) return undefined
    if (algorithm === 'bcrypt') {
      return cost !== undefined ? { algorithm, cost } : { algorithm }
    }
    const opts: {
      algorithm: typeof algorithm
      memoryCost?: number
      timeCost?: number
    } = { algorithm }
    if (memoryCost !== undefined) opts.memoryCost = memoryCost
    if (timeCost !== undefined) opts.timeCost = timeCost
    return opts
  }

  /** Hash a plaintext password into a self-describing PHC string. */
  hash(password: string): Promise<string> {
    return Bun.password.hash(password, this.bunOptions())
  }

  /**
   * Check a plaintext password against a stored hash. Returns `false` (never
   * throws) when the hash is malformed or the password does not match.
   */
  async verify(password: string, hash: string): Promise<boolean> {
    try {
      return await Bun.password.verify(password, hash)
    } catch {
      return false
    }
  }

  /**
   * Whether `hash` was produced by a different algorithm than the one currently
   * configured — call after a successful `verify` to transparently upgrade a
   * stored hash (e.g. migrating bcrypt → Argon2id) on the user's next login.
   */
  needsRehash(hash: string): boolean {
    const algorithm = this.options.algorithm ?? 'argon2id'
    const prefix = algorithm === 'bcrypt' ? '$2' : `$${algorithm}$`
    return !hash.startsWith(prefix)
  }
}
