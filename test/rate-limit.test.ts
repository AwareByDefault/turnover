import { describe, expect, test } from 'bun:test'
import { controller, createApp, get, rateLimit } from '../src'

@controller('/r')
class R {
  @get('/')
  go() {
    return { ok: true }
  }
}

describe('rateLimit()', () => {
  test('allows up to the limit, then replies 429 with Retry-After', async () => {
    const app = await createApp({
      controllers: [R],
      plugins: [rateLimit({ limit: 2, windowMs: 60_000, keyBy: () => 'k' })],
    })
    const call = () => app.handle(new Request('http://t/r'))
    expect((await call()).status).toBe(200)
    expect((await call()).status).toBe(200)
    const third = await call()
    expect(third.status).toBe(429)
    expect(third.headers.get('retry-after')).toBeTruthy()
    expect(third.headers.get('x-ratelimit-remaining')).toBe('0')
  })

  test('reports limit and remaining headers', async () => {
    const app = await createApp({
      controllers: [R],
      plugins: [rateLimit({ limit: 5, windowMs: 60_000, keyBy: () => 'k2' })],
    })
    const res = await app.handle(new Request('http://t/r'))
    expect(res.headers.get('x-ratelimit-limit')).toBe('5')
    expect(res.headers.get('x-ratelimit-remaining')).toBe('4')
  })

  test('separate keys get separate buckets', async () => {
    let key = 'a'
    const app = await createApp({
      controllers: [R],
      plugins: [rateLimit({ limit: 1, windowMs: 60_000, keyBy: () => key })],
    })
    expect((await app.handle(new Request('http://t/r'))).status).toBe(200)
    key = 'b'
    expect((await app.handle(new Request('http://t/r'))).status).toBe(200)
  })
})
