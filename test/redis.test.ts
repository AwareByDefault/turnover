import { describe, expect, test } from 'bun:test'
import {
  CACHE_STORE,
  cacheable,
  controller,
  createApp,
  get,
  inject,
  injectable,
  Passwordless,
  post,
  Session,
  session,
} from '../src'
import {
  type RedisCacheClient,
  redisCacheStore,
  redisOtpStore,
  redisSessionStore,
} from '../src/redis'

// A minimal in-memory RedisCacheClient stand-in that records TTLs.
function fakeRedis() {
  const store = new Map<string, string>()
  const ttls = new Map<string, number>()
  const client: RedisCacheClient = {
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
    async keys(pattern) {
      const rx = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`)
      return [...store.keys()].filter((key) => rx.test(key))
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

describe('redisCacheStore()', () => {
  test('round-trips values, applies TTL, and deletes', async () => {
    const redis = fakeRedis()
    const store = redisCacheStore(redis.client, { prefix: 'c:' })
    await store.set('k', { a: 1 }, 5000)
    expect(redis.ttls.get('c:k')).toBe(5) // ceil(5000ms / 1000)
    expect(await store.get('k')).toEqual({ a: 1 })
    await store.delete('k')
    expect(await store.get('k')).toBeUndefined()
  })

  test('clear() removes only this store’s prefixed keys', async () => {
    const redis = fakeRedis()
    redis.store.set('other:keep', '"x"')
    const store = redisCacheStore(redis.client, { prefix: 'turnover:cache:' })
    await store.set('a', 1)
    await store.set('b', 2)
    await store.clear()
    expect(await store.get('a')).toBeUndefined()
    expect(redis.store.get('other:keep')).toBe('"x"') // untouched
  })

  test('backs @cacheable over the container', async () => {
    let calls = 0
    @injectable()
    class Widgets {
      @cacheable()
      make(kind: string) {
        calls += 1
        return `widget:${kind}`
      }
    }
    const redis = fakeRedis()
    const app = await createApp({
      controllers: [],
      providers: [
        { provide: CACHE_STORE, useValue: redisCacheStore(redis.client) },
      ],
    })
    const widgets = app.container.resolve(Widgets)
    expect(await widgets.make('bolt')).toBe('widget:bolt')
    expect(await widgets.make('bolt')).toBe('widget:bolt')
    expect(calls).toBe(1) // second call served from Redis
    expect(redis.store.size).toBe(1)
  })
})
