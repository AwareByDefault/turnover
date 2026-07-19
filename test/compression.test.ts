import { describe, expect, test } from 'bun:test'
import { compression, controller, createApp, get } from '../src'

@controller('/c')
class C {
  @get('/big')
  big() {
    return { data: 'x'.repeat(5000) }
  }
  @get('/small')
  small() {
    return { ok: true }
  }
}

describe('compression()', () => {
  test('gzips a large text response when the client accepts it', async () => {
    const app = await createApp({ controllers: [C], plugins: [compression()] })
    const res = await app.handle(
      new Request('http://t/c/big', { headers: { 'accept-encoding': 'gzip' } }),
    )
    expect(res.headers.get('content-encoding')).toBe('gzip')
    expect(res.headers.get('vary')).toContain('accept-encoding')
    const raw = new Uint8Array(await res.arrayBuffer())
    const decoded = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(raw)))
    expect(decoded.data).toBe('x'.repeat(5000))
  })

  test('leaves the response uncompressed without accept-encoding', async () => {
    const app = await createApp({ controllers: [C], plugins: [compression()] })
    const res = await app.handle(new Request('http://t/c/big'))
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(((await res.json()) as { data: string }).data).toBe('x'.repeat(5000))
  })

  test('skips bodies below the threshold', async () => {
    const app = await createApp({ controllers: [C], plugins: [compression()] })
    const res = await app.handle(
      new Request('http://t/c/small', {
        headers: { 'accept-encoding': 'gzip' },
      }),
    )
    expect(res.headers.get('content-encoding')).toBeNull()
  })
})
