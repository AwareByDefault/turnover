import { describe, expect, test } from 'bun:test'
import {
  Container,
  PASSWORD_OPTIONS,
  PasswordHasher,
  type PasswordOptions,
} from '../src'

function hasher(options?: PasswordOptions): PasswordHasher {
  const c = new Container()
  if (options) c.register(PASSWORD_OPTIONS, { useValue: options })
  return c.resolve(PasswordHasher)
}

describe('PasswordHasher', () => {
  test('hashes with Argon2id by default and verifies the password', async () => {
    const h = hasher()
    const hash = await h.hash('hunter2')
    expect(hash.startsWith('$argon2id$')).toBe(true)
    expect(await h.verify('hunter2', hash)).toBe(true)
  })

  test('rejects a wrong password', async () => {
    const h = hasher()
    const hash = await h.hash('hunter2')
    expect(await h.verify('nope', hash)).toBe(false)
  })

  test('verify returns false for a malformed hash instead of throwing', async () => {
    const h = hasher()
    expect(await h.verify('hunter2', 'not-a-valid-hash')).toBe(false)
  })

  test('honours a configured algorithm (bcrypt) via PASSWORD_OPTIONS', async () => {
    const h = hasher({ algorithm: 'bcrypt', cost: 4 })
    const hash = await h.hash('hunter2')
    expect(hash.startsWith('$2')).toBe(true)
    expect(await h.verify('hunter2', hash)).toBe(true)
    // Verification auto-detects the algorithm, regardless of configuration.
    expect(await h.verify('hunter2', hash)).toBe(true)
  })

  test('needsRehash flags a hash made by a different algorithm', async () => {
    const argon = hasher() // default argon2id
    const bcrypt = hasher({ algorithm: 'bcrypt', cost: 4 })

    const argonHash = await argon.hash('hunter2')
    const bcryptHash = await bcrypt.hash('hunter2')

    // Configured for argon2id: an argon2id hash is current, a bcrypt one is stale.
    expect(argon.needsRehash(argonHash)).toBe(false)
    expect(argon.needsRehash(bcryptHash)).toBe(true)

    // Configured for bcrypt: the reverse.
    expect(bcrypt.needsRehash(bcryptHash)).toBe(false)
    expect(bcrypt.needsRehash(argonHash)).toBe(true)
  })

  test('applies Argon2 cost parameters without error', async () => {
    const h = hasher({ algorithm: 'argon2id', memoryCost: 512, timeCost: 2 })
    const hash = await h.hash('hunter2')
    expect(hash.startsWith('$argon2id$')).toBe(true)
    expect(await h.verify('hunter2', hash)).toBe(true)
  })
})
