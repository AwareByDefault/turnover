import { describe, expect, test } from 'bun:test'
import { bodyLimit, controller, createApp, post } from '../src'

@controller('/u')
class U {
  @post('/')
  upload() {
    return { ok: true }
  }
}

describe('bodyLimit()', () => {
  test('rejects an over-limit body with 413', async () => {
    const app = await createApp({ controllers: [U], plugins: [bodyLimit(100)] })
    const res = await app.handle(
      new Request('http://t/u', {
        method: 'POST',
        // A real server request carries Content-Length; set it explicitly here.
        headers: { 'content-length': '5000' },
        body: 'x'.repeat(5000),
      }),
    )
    expect(res.status).toBe(413)
  })

  test('allows a request within the limit', async () => {
    const app = await createApp({
      controllers: [U],
      plugins: [bodyLimit(10_000)],
    })
    const res = await app.handle(
      new Request('http://t/u', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ a: 1 }),
      }),
    )
    expect(res.status).toBe(200)
  })

  test('allows a request with no body', async () => {
    const app = await createApp({ controllers: [U], plugins: [bodyLimit(100)] })
    const res = await app.handle(new Request('http://t/u', { method: 'POST' }))
    expect(res.status).toBe(200)
  })
})
