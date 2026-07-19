import { describe, expect, test } from 'bun:test'
import {
  controller,
  createApp,
  get,
  inject,
  Passwordless,
  post,
  Session,
  session,
} from '../src'
import {
  type RedisClient,
  redisOtpStore,
  redisSessionStore,
} from '../src/redis'

// A minimal in-memory RedisClient stand-in that records TTLs.
function fakeRedis() {
  const store = new Map<string, string>()
  const ttls = new Map<string, number>()
  const client: RedisClient = {
    async get(key) {
      return store.get(key) ?? null
    },
    async set(key, value) {
      store.set(key, value)
    },
    async del(key) {
      store.delete(key)
    },
    async expire(key, seconds) {
      ttls.set(key, seconds)
    },
  }
  return { client, store, ttls }
}

describe('redisSessionStore()', () => {
  test('round-trips data through the client and prefixes keys', async () => {
    const redis = fakeRedis()
    const store = redisSessionStore(redis.client, { prefix: 'sess:' })
    await store.set('abc', { userId: '1' })
    expect([...redis.store.keys()]).toEqual(['sess:abc'])
    expect(await store.get('abc')).toEqual({ userId: '1' })
    await store.destroy('abc')
    expect(await store.get('abc')).toBeUndefined()
  })

  test('applies a TTL when configured', async () => {
    const redis = fakeRedis()
    const store = redisSessionStore(redis.client, { ttl: 3600 })
    await store.set('abc', { x: 1 })
    expect(redis.ttls.get('turnover:sess:abc')).toBe(3600)
  })

  test('backs a real session() flow', async () => {
    @controller('/s')
    class S {
      private readonly session = inject(Session)
      @post('/login')
      login() {
        this.session.set('userId', 'u1')
        return { ok: true }
      }
      @get('/me')
      me() {
        return { userId: this.session.get<string>('userId') ?? null }
      }
    }
    const redis = fakeRedis()
    const app = await createApp({
      controllers: [S],
      plugins: [session({ store: redisSessionStore(redis.client) })],
    })
    const login = await app.handle(
      new Request('http://t/s/login', { method: 'POST' }),
    )
    const sid = login.headers.get('set-cookie')?.match(/sid=([^;]+)/)?.[1]
    // The session data actually landed in the (fake) Redis.
    expect(redis.store.size).toBe(1)
    const me = await app.handle(
      new Request('http://t/s/me', { headers: { cookie: `sid=${sid}` } }),
    )
    expect(await me.json()).toEqual({ userId: 'u1' })
  })
})

describe('redisOtpStore()', () => {
  test('gives each code a Redis TTL matching its expiry', async () => {
    const redis = fakeRedis()
    const store = redisOtpStore(redis.client, { clock: () => 1000 })
    await store.set('a@b.io', {
      hash: 'h',
      expiresAt: 1000 + 600_000,
      attempts: 0,
    })
    // ttl = ceil((expiresAt - now) / 1000) = 600 seconds.
    expect(redis.ttls.get('turnover:otp:a@b.io')).toBe(600)
    expect(await store.get('a@b.io')).toMatchObject({ hash: 'h', attempts: 0 })
  })

  test('backs a real Passwordless issue/verify flow', async () => {
    const redis = fakeRedis()
    const otp = new Passwordless({ store: redisOtpStore(redis.client) })
    const code = await otp.issue('ada@acme.io')
    expect(redis.store.size).toBe(1)
    expect(await otp.verify('ada@acme.io', code)).toBe(true)
    // Consumed on success — the entry is gone from Redis.
    expect(redis.store.size).toBe(0)
  })
})
