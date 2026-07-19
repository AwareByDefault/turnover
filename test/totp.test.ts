import { describe, expect, test } from 'bun:test'
import { Totp } from '../src'

// RFC 6238 Appendix B test vectors (SHA1, 8 digits, 30s step). The seed is the
// ASCII "12345678901234567890" encoded as base32.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const RFC_VECTORS: Array<[number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
]

describe('Totp', () => {
  test('matches the RFC 6238 SHA1 test vectors', () => {
    const totp = new Totp({ digits: 8 })
    for (const [seconds, expected] of RFC_VECTORS) {
      expect(totp.code(RFC_SECRET, new Date(seconds * 1000))).toBe(expected)
    }
  })

  test('produces a 6-digit code by default', () => {
    const code = new Totp().code(RFC_SECRET, new Date(59_000))
    expect(code).toMatch(/^\d{6}$/)
  })

  test('generates a decodable base32 secret that round-trips', () => {
    const totp = new Totp()
    const secret = totp.generateSecret()
    expect(secret).toMatch(/^[A-Z2-7]+$/)
    const at = new Date(1_600_000_000_000)
    const code = totp.code(secret, at)
    expect(totp.verify(secret, code, { at })).toBe(true)
  })

  test('verify accepts the current code and rejects a wrong one', () => {
    const totp = new Totp()
    const secret = totp.generateSecret()
    const at = new Date(1_600_000_000_000)
    const code = totp.code(secret, at)
    expect(totp.verify(secret, code, { at })).toBe(true)
    const wrong = code === '000000' ? '111111' : '000000'
    expect(totp.verify(secret, wrong, { at })).toBe(false)
  })

  test('verify tolerates ±window steps of clock skew', () => {
    const totp = new Totp()
    const secret = totp.generateSecret()
    const now = new Date(1_600_000_000_000)
    const previousStep = new Date(now.getTime() - 30_000)
    const codeFromPreviousStep = totp.code(secret, previousStep)

    // A code from the previous step is accepted with window ≥ 1…
    expect(
      totp.verify(secret, codeFromPreviousStep, { at: now, window: 1 }),
    ).toBe(true)
    // …but not with window 0 (exact step only).
    expect(
      totp.verify(secret, codeFromPreviousStep, { at: now, window: 0 }),
    ).toBe(false)
  })

  test('ignores surrounding whitespace in a submitted token', () => {
    const totp = new Totp()
    const secret = totp.generateSecret()
    const at = new Date(1_600_000_000_000)
    const code = totp.code(secret, at)
    expect(totp.verify(secret, `  ${code} `, { at })).toBe(true)
  })

  test('builds an otpauth:// provisioning URI', () => {
    const uri = new Totp().uri({
      secret: RFC_SECRET,
      issuer: 'Acme',
      account: 'ada@acme.io',
    })
    expect(uri).toStartWith('otpauth://totp/Acme%3Aada%40acme.io?')
    expect(uri).toContain(`secret=${RFC_SECRET}`)
    expect(uri).toContain('issuer=Acme')
    expect(uri).toContain('algorithm=SHA1')
    expect(uri).toContain('digits=6')
    expect(uri).toContain('period=30')
  })

  test('supports SHA256 with a longer code', () => {
    const totp = new Totp({ algorithm: 'SHA256', digits: 8 })
    const secret = totp.generateSecret()
    const at = new Date(1_600_000_000_000)
    const code = totp.code(secret, at)
    expect(code).toMatch(/^\d{8}$/)
    expect(totp.verify(secret, code, { at })).toBe(true)
  })
})
