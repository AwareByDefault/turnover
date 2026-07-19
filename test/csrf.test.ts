import { describe, expect, test } from 'bun:test'
import { controller, createApp, csrf, get, post } from '../src'

@controller('/c')
class C {
  @get('/token')
  token() {
    return { ok: true }
  }
  @post('/action')
  action() {
    return { done: true }
  }
}

function tokenFrom(setCookie: string | null): string | undefined {
  return setCookie?.match(/csrf-token=([^;]+)/)?.[1]
}

describe('csrf()', () => {
  test('mints a token cookie on a safe request', async () => {
    const app = await createApp({ controllers: [C], plugins: [csrf()] })
    const res = await app.handle(new Request('http://t/c/token'))
    expect(res.status).toBe(200)
    const set = res.headers.get('set-cookie')
    expect(tokenFrom(set)).toBeTruthy()
    expect(set).toContain('SameSite=Strict')
  })

  test('rejects an unsafe request carrying no token', async () => {
    const app = await createApp({ controllers: [C], plugins: [csrf()] })
    const res = await app.handle(
      new Request('http://t/c/action', { method: 'POST' }),
    )
    expect(res.status).toBe(403)
  })

  test('accepts an unsafe request whose header matches the cookie', async () => {
    const app = await createApp({ controllers: [C], plugins: [csrf()] })
    const token = tokenFrom(
      (await app.handle(new Request('http://t/c/token'))).headers.get(
        'set-cookie',
      ),
    )
    const res = await app.handle(
      new Request('http://t/c/action', {
        method: 'POST',
        headers: {
          cookie: `csrf-token=${token}`,
          'x-csrf-token': token as string,
        },
      }),
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { done: boolean }).done).toBe(true)
  })

  test('rejects when the header does not match the cookie', async () => {
    const app = await createApp({ controllers: [C], plugins: [csrf()] })
    const res = await app.handle(
      new Request('http://t/c/action', {
        method: 'POST',
        headers: { cookie: 'csrf-token=aaa', 'x-csrf-token': 'bbb' },
      }),
    )
    expect(res.status).toBe(403)
  })

  test('does not re-mint when a token cookie already exists', async () => {
    const app = await createApp({ controllers: [C], plugins: [csrf()] })
    const res = await app.handle(
      new Request('http://t/c/token', {
        headers: { cookie: 'csrf-token=existing' },
      }),
    )
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  test('honours a custom header and safe-method set', async () => {
    const app = await createApp({
      controllers: [C],
      plugins: [csrf({ header: 'x-xsrf', safeMethods: ['GET'] })],
    })
    const token = tokenFrom(
      (await app.handle(new Request('http://t/c/token'))).headers.get(
        'set-cookie',
      ),
    )
    const res = await app.handle(
      new Request('http://t/c/action', {
        method: 'POST',
        headers: { cookie: `csrf-token=${token}`, 'x-xsrf': token as string },
      }),
    )
    expect(res.status).toBe(200)
  })
})
