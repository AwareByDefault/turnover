import { createHash, randomInt, timingSafeEqual } from 'node:crypto'

/** A stored, hashed one-time code with its expiry and attempt count. */
export interface OtpRecord {
  /** SHA-256 hex of the code — the plaintext is never stored. */
  hash: string
  /** Epoch ms after which the code is invalid. */
  expiresAt: number
  /** Failed verification attempts so far. */
  attempts: number
}

/** Pluggable storage for pending one-time codes, keyed by identifier. */
export interface OtpStore {
  /**
   * Store (or replace) the pending record for an identifier.
   *
   * @param identifier - The account key (e.g. email or phone).
   * @param record - The hashed code, expiry, and attempt count to persist.
   */
  set(identifier: string, record: OtpRecord): Promise<void>
  /**
   * Load the pending record for an identifier, or `undefined` if none.
   *
   * @param identifier - The account key to look up.
   * @returns The stored record, or `undefined` if none is pending.
   */
  get(identifier: string): Promise<OtpRecord | undefined>
  /**
   * Remove the pending code for an identifier.
   *
   * @param identifier - The account key whose pending code to remove.
   */
  delete(identifier: string): Promise<void>
}

/**
 * In-memory {@link OtpStore} backed by a `Map`. Fine for one process or tests.
 *
 * @returns An {@link OtpStore} that keeps records in memory.
 */
export function memoryOtpStore(): OtpStore {
  const map = new Map<string, OtpRecord>()
  return {
    async set(identifier, record) {
      map.set(identifier, record)
    },
    async get(identifier) {
      return map.get(identifier)
    },
    async delete(identifier) {
      map.delete(identifier)
    },
  }
}

const DIGITS = '0123456789'

/** Options for {@link Passwordless}. */
export interface PasswordlessOptions {
  /** Backing store (default {@link memoryOtpStore}). */
  store?: OtpStore
  /** Lifetime of an issued code in seconds (default 600 = 10 minutes). */
  ttl?: number
  /** Length of a generated code (default 6). Ignored when `generateCode` is set. */
  codeLength?: number
  /** Alphabet for generated codes (default digits). Ignored when `generateCode` is set. */
  alphabet?: string
  /** Verification attempts allowed before the code is burned (default 5). */
  maxAttempts?: number
  /** Custom code generator — e.g. a long URL-safe token for magic links. */
  generateCode?: () => string
  /** Clock source (default `Date.now`). Override for deterministic tests. */
  clock?: () => number
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/**
 * Passwordless authentication via one-time codes — email OTP or magic-link
 * tokens. `issue` a code for an identifier (an email, a phone number) and send
 * it yourself (e.g. with `Mailer`); `verify` the code the user submits. Codes
 * are stored only as SHA-256 hashes, expire after `ttl`, are single-use
 * (consumed on success), and burn after `maxAttempts` wrong tries. Supply
 * `generateCode` with a long random token to implement magic links instead of
 * numeric OTPs.
 *
 * ```ts
 * const otp = new Passwordless()
 * const code = await otp.issue('ada@acme.io')   // then email `code` via Mailer
 * // …later, when the user submits it:
 * const ok = await otp.verify('ada@acme.io', submitted)
 * ```
 */
export class Passwordless {
  private readonly store: OtpStore
  private readonly ttl: number
  private readonly codeLength: number
  private readonly alphabet: string
  private readonly maxAttempts: number
  private readonly generate: () => string
  private readonly now: () => number

  /** Create a passwordless issuer/verifier from the given options. */
  constructor(options: PasswordlessOptions = {}) {
    this.store = options.store ?? memoryOtpStore()
    this.ttl = options.ttl ?? 600
    this.codeLength = options.codeLength ?? 6
    this.alphabet = options.alphabet ?? DIGITS
    this.maxAttempts = options.maxAttempts ?? 5
    this.now = options.clock ?? Date.now
    this.generate = options.generateCode ?? (() => this.randomCode())
  }

  private randomCode(): string {
    let code = ''
    for (let i = 0; i < this.codeLength; i++) {
      code += this.alphabet[randomInt(0, this.alphabet.length)]
    }
    return code
  }

  /**
   * Issue a fresh code for `identifier` and return it to send out of band
   * (e.g. email or SMS). Replaces any pending code for that identifier and resets
   * its attempt counter, so re-issuing hands the user a clean `maxAttempts` budget;
   * the code expires `ttl` seconds from now.
   *
   * @param identifier - The account to issue a code for (e.g. email or phone).
   * @returns The plaintext code — the only moment it exists in the clear, since only its SHA-256 hash is persisted.
   */
  async issue(identifier: string): Promise<string> {
    const code = this.generate()
    await this.store.set(identifier, {
      hash: hashCode(code),
      expiresAt: this.now() + this.ttl * 1000,
      attempts: 0,
    })
    return code
  }

  /**
   * Check a submitted `code` for `identifier`. Consumes the code on success;
   * counts the attempt and burns the code once `maxAttempts` is reached, or when
   * it has expired.
   *
   * @param identifier - The account the code was issued for.
   * @param code - the code the user submitted; surrounding whitespace is trimmed before a constant-time hash comparison.
   * @returns `true` if the code matched a live record (which is then consumed), else `false` — including when it was wrong, expired, or already exhausted.
   */
  async verify(identifier: string, code: string): Promise<boolean> {
    const record = await this.store.get(identifier)
    if (!record) return false
    if (record.expiresAt < this.now() || record.attempts >= this.maxAttempts) {
      await this.store.delete(identifier)
      return false
    }
    if (safeEqualHex(hashCode(code.trim()), record.hash)) {
      await this.store.delete(identifier) // single use
      return true
    }
    record.attempts += 1
    if (record.attempts >= this.maxAttempts) {
      await this.store.delete(identifier)
    } else {
      await this.store.set(identifier, record)
    }
    return false
  }
}
