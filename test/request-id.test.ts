import { describe, expect, test } from 'bun:test'
import { controller, createApp, get, getRequestId, requestId } from '../src'

describe('requestId()', () => {
  test('generates an id and echoes it on the response', async () => {
    @controller('/r')
    class R {
      @get('/')
      go() {
        return { ok: true }
      }
    }
    const app = await createApp({ controllers: [R], plugins: [requestId()] })
    const res = await app.handle(new Request('http://t/r'))
    const id = res.headers.get('x-request-id')
    expect(id).toBeTruthy()
    // crypto.randomUUID() shape
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/)
  })

  test('reuses an inbound x-request-id header', async () => {
    @controller('/r2')
    class R {
      @get('/')
      go() {
        return { ok: true }
      }
    }
    const app = await createApp({ controllers: [R], plugins: [requestId()] })
    const res = await app.handle(
      new Request('http://t/r2', { headers: { 'x-request-id': 'abc-123' } }),
    )
    expect(res.headers.get('x-request-id')).toBe('abc-123')
  })

  test('getRequestId() reads the id inside a handler', async () => {
    let seen: string | undefined
    @controller('/r3')
    class R {
      @get('/')
      go() {
        seen = getRequestId()
        return { ok: true }
      }
    }
    const app = await createApp({ controllers: [R], plugins: [requestId()] })
    const res = await app.handle(
      new Request('http://t/r3', { headers: { 'x-request-id': 'trace-1' } }),
    )
    expect(seen).toBe('trace-1')
    expect(res.headers.get('x-request-id')).toBe('trace-1')
  })

  test('honors a custom header and generator', async () => {
    let n = 0
    @controller('/r4')
    class R {
      @get('/')
      go() {
        return { ok: true }
      }
    }
    const app = await createApp({
      controllers: [R],
      plugins: [
        requestId({ header: 'x-correlation-id', generate: () => `id-${++n}` }),
      ],
    })
    const res = await app.handle(new Request('http://t/r4'))
    expect(res.headers.get('x-correlation-id')).toBe('id-1')
  })

  test('getRequestId() is undefined without the plugin', async () => {
    let seen: string | undefined = 'unset'
    @controller('/r5')
    class R {
      @get('/')
      go() {
        seen = getRequestId()
        return { ok: true }
      }
    }
    const app = await createApp({ controllers: [R] })
    await app.handle(new Request('http://t/r5'))
    expect(seen).toBeUndefined()
  })
})
