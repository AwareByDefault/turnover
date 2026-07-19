import { describe, expect, test } from 'bun:test'
import { memoryOtpStore, Passwordless } from '../src'

describe('Passwordless', () => {
  test('issues a code of the configured length and verifies it once', async () => {
    const otp = new Passwordless({ codeLength: 6 })
    const code = await otp.issue('ada@acme.io')
    expect(code).toMatch(/^\d{6}$/)
    expect(await otp.verify('ada@acme.io', code)).toBe(true)
    // Single-use: the code is consumed on success.
    expect(await otp.verify('ada@acme.io', code)).toBe(false)
  })

  test('rejects a wrong code', async () => {
    const otp = new Passwordless()
    await otp.issue('ada@acme.io')
    expect(await otp.verify('ada@acme.io', '000000')).toBe(false)
  })

  test('burns the code after maxAttempts wrong tries', async () => {
    const otp = new Passwordless({ maxAttempts: 3 })
    const code = await otp.issue('ada@acme.io')
    expect(await otp.verify('ada@acme.io', 'aaaaaa')).toBe(false)
    expect(await otp.verify('ada@acme.io', 'bbbbbb')).toBe(false)
    expect(await otp.verify('ada@acme.io', 'cccccc')).toBe(false)
    // Third wrong try reaches the limit and burns it — even the real code fails.
    expect(await otp.verify('ada@acme.io', code)).toBe(false)
  })

  test('rejects an expired code', async () => {
    const clock = { t: 1000 }
    const otp = new Passwordless({ ttl: 60, clock: () => clock.t })
    const code = await otp.issue('ada@acme.io') // expiresAt = 1000 + 60_000
    clock.t = 1000 + 60_000 + 1
    expect(await otp.verify('ada@acme.io', code)).toBe(false)
  })

  test('stores only a hash, never the plaintext code', async () => {
    const store = memoryOtpStore()
    const otp = new Passwordless({ store })
    const code = await otp.issue('ada@acme.io')
    const record = await store.get('ada@acme.io')
    expect(record?.hash).toBeTruthy()
    expect(record?.hash).not.toBe(code)
    expect(record?.hash).toMatch(/^[0-9a-f]{64}$/) // sha256 hex
  })

  test('supports a custom generator for magic-link tokens', async () => {
    let n = 0
    const otp = new Passwordless({
      generateCode: () => {
        n += 1
        return `magic-token-${n}`
      },
    })
    const token = await otp.issue('ada@acme.io')
    expect(token).toBe('magic-token-1')
    expect(await otp.verify('ada@acme.io', 'magic-token-1')).toBe(true)
  })

  test('ignores surrounding whitespace on the submitted code', async () => {
    const otp = new Passwordless()
    const code = await otp.issue('ada@acme.io')
    expect(await otp.verify('ada@acme.io', `  ${code} `)).toBe(true)
  })

  test('verifying an unknown identifier returns false', async () => {
    const otp = new Passwordless()
    expect(await otp.verify('nobody@acme.io', '123456')).toBe(false)
  })
})
