import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** Hash used by the TOTP HMAC (RFC 6238 permits all three). */
export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512'

/** Options for {@link Totp}. Omitted fields use the RFC-6238 defaults. */
export interface TotpOptions {
  /** Time step in seconds (default 30). */
  period?: number
  /** Number of digits in a code (default 6). */
  digits?: number
  /** HMAC hash (default `"SHA1"`, as most authenticator apps expect). */
  algorithm?: TotpAlgorithm
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32 (no padding) — the encoding authenticator apps use. */
function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error(`Invalid base32 character: "${char}".`)
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** One HOTP code (RFC 4226) for a counter — the primitive TOTP builds on. */
function hotp(
  secret: Buffer,
  counter: number,
  digits: number,
  algorithm: string,
): string {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac(algorithm, secret).update(message).digest()
  // Dynamic truncation per RFC 4226: the low nibble of the last byte picks the
  // offset; read 31 bits there and take the low `digits` decimal places.
  const offset = digest.readUInt8(digest.length - 1) & 0x0f
  const binary = digest.readUInt32BE(offset) & 0x7fffffff
  return (binary % 10 ** digits).toString().padStart(digits, '0')
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/**
 * RFC 6238 time-based one-time passwords — the TOTP half of MFA. Stateless and
 * dependency-free (Node crypto); pair it with `PasswordHasher` for a second
 * factor. Store the per-user base32 secret from {@link Totp.generateSecret},
 * show {@link Totp.uri} as a QR code to enrol an authenticator app, and check
 * codes at sign-in with {@link Totp.verify}.
 *
 * ```ts
 * const totp = new Totp()
 * const secret = totp.generateSecret()          // store against the user
 * const otpauth = totp.uri({ secret, issuer: 'Acme', account: 'ada@acme.io' })
 * // …later: totp.verify(secret, submittedCode)
 * ```
 */
export class Totp {
  private readonly period: number
  private readonly digits: number
  private readonly algorithm: TotpAlgorithm

  /** Create a TOTP helper with the given period, digits, and algorithm. */
  constructor(options: TotpOptions = {}) {
    this.period = options.period ?? 30
    this.digits = options.digits ?? 6
    this.algorithm = options.algorithm ?? 'SHA1'
  }

  /**
   * A fresh random base32 secret (default 20 bytes / 160 bits).
   *
   * @param bytes - number of random bytes of entropy (default 20 = 160 bits, the RFC 4226 recommendation; raise, e.g. to 32, for a stronger secret).
   * @returns The secret, base32-encoded for authenticator apps.
   */
  generateSecret(bytes = 20): string {
    return base32Encode(randomBytes(bytes))
  }

  /**
   * The code for a base32 `secret` at a given time (default now).
   *
   * @param secret - The user's base32-encoded shared secret.
   * @param at - The time to compute the code for (default now).
   * @returns The current TOTP code, zero-padded to `digits`.
   */
  code(secret: string, at: Date = nowDate()): string {
    const counter = Math.floor(at.getTime() / 1000 / this.period)
    return hotp(
      base32Decode(secret),
      counter,
      this.digits,
      this.algorithm.toLowerCase(),
    )
  }

  /**
   * Whether `token` is valid for `secret`, tolerating clock skew of `±window`
   * time steps (default 1, i.e. the adjacent codes). Constant-time comparison.
   *
   * @remarks Each extra `window` step also widens replay exposure: a captured
   * code stays acceptable for `(2·window + 1) · period` seconds. There is no
   * built-in single-use tracking — record and reject codes you have already
   * accepted if replay within that window matters.
   * @param secret - The user's base32-encoded shared secret.
   * @param token - the code the user submitted; trimmed before comparison.
   * @param options - `window` is the ± number of `period` steps of clock skew to accept (default 1 = previous, current, and next code); `at` overrides the reference time (default now).
   */
  verify(
    secret: string,
    token: string,
    options: { window?: number; at?: Date } = {},
  ): boolean {
    const window = options.window ?? 1
    const at = options.at ?? nowDate()
    const counter = Math.floor(at.getTime() / 1000 / this.period)
    const key = base32Decode(secret)
    const candidate = token.trim()
    const algorithm = this.algorithm.toLowerCase()
    for (let offset = -window; offset <= window; offset++) {
      if (
        safeEqual(
          hotp(key, counter + offset, this.digits, algorithm),
          candidate,
        )
      ) {
        return true
      }
    }
    return false
  }

  /**
   * An `otpauth://totp/...` provisioning URI to render as a QR code for
   * enrolment. This instance's `algorithm`, `digits`, and `period` are embedded
   * so a compliant app configures itself to match {@link Totp.verify}.
   *
   * @remarks Some apps (notably Google Authenticator) ignore those parameters and
   * assume SHA1 / 6 digits / 30s — keep the defaults for the widest compatibility.
   * @param options - `secret` (this user's base32 secret), `issuer` (your app name, shown in the authenticator), and `account` (the user's label, e.g. their email); both text fields are URI-encoded.
   */
  uri(options: { secret: string; issuer: string; account: string }): string {
    const label = encodeURIComponent(`${options.issuer}:${options.account}`)
    const params = new URLSearchParams({
      secret: options.secret,
      issuer: options.issuer,
      algorithm: this.algorithm,
      digits: String(this.digits),
      period: String(this.period),
    })
    return `otpauth://totp/${label}?${params.toString()}`
  }
}

// Isolated so the rest stays a pure function of its inputs.
function nowDate(): Date {
  return new Date()
}
