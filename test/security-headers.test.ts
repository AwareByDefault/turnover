import { describe, expect, test } from 'bun:test'
import { controller, createApp, get, securityHeaders } from '../src'

@controller('/s')
class S {
  @get('/')
  ok() {
    return { ok: true }
  }
  @get('/framed')
  framed(ctx: { set: { headers: Headers } }) {
    ctx.set.headers.set('x-frame-options', 'SAMEORIGIN')
    return { ok: true }
  }
}

describe('securityHeaders()', () => {
  test('sets the baseline headers on every response', async () => {
    const app = await createApp({
      controllers: [S],
      plugins: [securityHeaders()],
    })
    const res = await app.handle(new Request('http://t/s'))
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'self'",
    )
    expect(res.headers.get('strict-transport-security')).toContain('max-age=')
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin')
  })

  test('overrides a header and omits one set to false', async () => {
    const app = await createApp({
      controllers: [S],
      plugins: [
        securityHeaders({
          frameOptions: 'SAMEORIGIN',
          contentSecurityPolicy: false,
        }),
      ],
    })
    const res = await app.handle(new Request('http://t/s'))
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(res.headers.get('content-security-policy')).toBeNull()
  })

  test('does not clobber a header the handler already set', async () => {
    const app = await createApp({
      controllers: [S],
      plugins: [securityHeaders()],
    })
    const res = await app.handle(new Request('http://t/s/framed'))
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN')
  })
})
