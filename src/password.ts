import { InjectionToken, injectable, injectOptional } from './di'

/** Supported password-hashing algorithms (Bun's built-ins); `argon2id` — the memory-hard, side-channel-resistant hybrid — is the recommended default. */
export type PasswordAlgorithm = 'argon2id' | 'argon2i' | 'argon2d' | 'bcrypt'

/** Tuning for {@link PasswordHasher}. Omitted fields use Bun's defaults. */
export interface PasswordOptions {
  /** Algorithm to hash with (default `"argon2id"`). Verification auto-detects. */
  algorithm?: PasswordAlgorithm
  /** Argon2 memory cost in KiB (higher is more memory-hard and slower); ignored when `algorithm` is `bcrypt`. */
  memoryCost?: number
  /** Argon2 iteration count (higher slows both hashing and brute-forcing); ignored when `algorithm` is `bcrypt`. */
  timeCost?: number
  /** bcrypt cost factor — hashing runs `2^cost` rounds, so each +1 doubles the time; ignored for Argon2. */
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

  /**
   * Hash a plaintext password into a self-describing PHC string — the algorithm,
   * its cost parameters, and a random per-hash salt are all embedded, so no
   * separate salt column is needed.
   *
   * @remarks Under `bcrypt`, Bun silently truncates the input to 72 bytes (a
   * bcrypt limitation); prefer an Argon2 variant to hash the full password.
   * @param password - the plaintext to hash; a fresh salt is drawn each call, so the same password produces a different hash every time (never compare hashes for equality — use {@link PasswordHasher.verify}).
   * @returns A promise for the PHC-format hash string.
   */
  hash(password: string): Promise<string> {
    return Bun.password.hash(password, this.bunOptions())
  }

  /**
   * Check a plaintext password against a stored hash. Returns `false` (never
   * throws) when the hash is malformed or the password does not match.
   *
   * @param password - The plaintext password to check.
   * @param hash - The stored hash to check against.
   * @returns A promise for `true` if the password matches, otherwise `false`.
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
   *
   * @param hash - The stored hash to inspect.
   * @returns `true` if `hash` should be re-hashed with the configured algorithm.
   */
  needsRehash(hash: string): boolean {
    const algorithm = this.options.algorithm ?? 'argon2id'
    const prefix = algorithm === 'bcrypt' ? '$2' : `$${algorithm}$`
    return !hash.startsWith(prefix)
  }
}
