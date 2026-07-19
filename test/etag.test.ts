import { describe, expect, test } from 'bun:test'
import { controller, createApp, etag, get, post } from '../src'

@controller('/e')
class E {
  @get('/')
  list() {
    return { items: [1, 2, 3] }
  }
  @post('/')
  create() {
    return { ok: true }
  }
}

describe('etag()', () => {
  test('adds a weak ETag to a GET 200 response', async () => {
    const app = await createApp({ controllers: [E], plugins: [etag()] })
    const res = await app.handle(new Request('http://t/e'))
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toMatch(/^W\/"/)
  })

  test('answers 304 with an empty body when If-None-Match matches', async () => {
    const app = await createApp({ controllers: [E], plugins: [etag()] })
    const first = await app.handle(new Request('http://t/e'))
    const tag = first.headers.get('etag')!
    const second = await app.handle(
      new Request('http://t/e', { headers: { 'if-none-match': tag } }),
    )
    expect(second.status).toBe(304)
    expect(second.headers.get('etag')).toBe(tag)
    expect(await second.text()).toBe('')
  })

  test('returns 200 with the body when If-None-Match does not match', async () => {
    const app = await createApp({ controllers: [E], plugins: [etag()] })
    const res = await app.handle(
      new Request('http://t/e', { headers: { 'if-none-match': 'W/"stale"' } }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [1, 2, 3] })
  })

  test('does not tag non-GET methods by default', async () => {
    const app = await createApp({ controllers: [E], plugins: [etag()] })
    const res = await app.handle(new Request('http://t/e', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBeNull()
  })
})
