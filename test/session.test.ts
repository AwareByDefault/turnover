import { describe, expect, test } from 'bun:test'
import {
  Auth,
  authenticated,
  controller,
  createApp,
  derive,
  get,
  inject,
  memorySessionStore,
  type Principal,
  post,
  Session,
  session,
  setPrincipal,
} from '../src'

@controller('/s')
class S {
  private readonly session = inject(Session)

  @get('/ping')
  ping() {
    return { ok: true }
  }

  @post('/login')
  login() {
    this.session.set('userId', 'u1')
    return { id: this.session.id }
  }

  @get('/me')
  me() {
    return {
      userId: this.session.get<string>('userId') ?? null,
      id: this.session.id ?? null,
    }
  }

  @post('/rotate')
  rotate() {
    this.session.set('userId', 'u1')
    this.session.regenerate()
    return { id: this.session.id }
  }

  @post('/logout')
  logout() {
    this.session.destroy()
    return { ok: true }
  }
}

function sidFrom(setCookie: string | null): string | undefined {
  return setCookie?.match(/sid=([^;]+)/)?.[1]
}

describe('session()', () => {
  test('sets no cookie for a request that never touches the session', async () => {
    const app = await createApp({ controllers: [S], plugins: [session()] })
    const res = await app.handle(new Request('http://t/s/ping'))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  test('mints an HttpOnly sid cookie on first write', async () => {
    const app = await createApp({ controllers: [S], plugins: [session()] })
    const res = await app.handle(
      new Request('http://t/s/login', { method: 'POST' }),
    )
    const set = res.headers.get('set-cookie')
    const sid = sidFrom(set)
    expect(sid).toBeTruthy()
    expect(set).toContain('HttpOnly')
    expect(set).toContain('SameSite=Lax')
    expect(((await res.json()) as { id: string }).id).toBe(sid as string)
  })

  test('reads persisted data back on the next request', async () => {
    const store = memorySessionStore()
    const app = await createApp({
      controllers: [S],
      plugins: [session({ store })],
    })
    const sid = sidFrom(
      (
        await app.handle(new Request('http://t/s/login', { method: 'POST' }))
      ).headers.get('set-cookie'),
    )
    const res = await app.handle(
      new Request('http://t/s/me', { headers: { cookie: `sid=${sid}` } }),
    )
    expect(await res.json()).toEqual({ userId: 'u1', id: sid })
  })

  test('regenerate() issues a new id but keeps the data', async () => {
    const app = await createApp({ controllers: [S], plugins: [session()] })
    // First establish a session, then rotate its id.
    const first = await app.handle(
      new Request('http://t/s/login', { method: 'POST' }),
    )
    const sid1 = sidFrom(first.headers.get('set-cookie'))
    const rotated = await app.handle(
      new Request('http://t/s/rotate', {
        method: 'POST',
        headers: { cookie: `sid=${sid1}` },
      }),
    )
    const sid2 = sidFrom(rotated.headers.get('set-cookie'))
    expect(sid2).toBeTruthy()
    expect(sid2).not.toBe(sid1)
    // The old id is gone; the new one carries the data.
    const viaOld = await app.handle(
      new Request('http://t/s/me', { headers: { cookie: `sid=${sid1}` } }),
    )
    expect(await viaOld.json()).toEqual({ userId: null, id: null })
    const viaNew = await app.handle(
      new Request('http://t/s/me', { headers: { cookie: `sid=${sid2}` } }),
    )
    expect(await viaNew.json()).toEqual({ userId: 'u1', id: sid2 })
  })

  test('destroy() expires the cookie and drops the stored session', async () => {
    const app = await createApp({ controllers: [S], plugins: [session()] })
    const sid = sidFrom(
      (
        await app.handle(new Request('http://t/s/login', { method: 'POST' }))
      ).headers.get('set-cookie'),
    )
    const out = await app.handle(
      new Request('http://t/s/logout', {
        method: 'POST',
        headers: { cookie: `sid=${sid}` },
      }),
    )
    const cleared = out.headers.get('set-cookie')
    expect(cleared).toContain('sid=')
    expect(cleared).toContain('Max-Age=0')
    // The session is gone from the store.
    const after = await app.handle(
      new Request('http://t/s/me', { headers: { cookie: `sid=${sid}` } }),
    )
    expect(await after.json()).toEqual({ userId: null, id: null })
  })
})

// A worked login → session → principal → authorization flow across requests.
const USERS: Record<string, { id: string; name: string; roles: string[] }> = {
  u1: { id: 'u1', name: 'Ada', roles: ['user'] },
}

@controller('/acct')
@derive(() => {
  const uid = new Session().get<string>('userId')
  if (uid && USERS[uid]) setPrincipal(USERS[uid] as unknown as Principal)
})
class Acct {
  private readonly session = inject(Session)
  private readonly auth = inject(Auth)

  @post('/login')
  login() {
    // In a real handler you'd verify credentials first, then:
    this.session.regenerate() // fresh id post-auth (fixation defense)
    this.session.set('userId', 'u1')
    return { ok: true }
  }

  @get('/me')
  @authenticated
  me() {
    const user = this.auth.user as unknown as { id: string; name: string }
    return { id: user.id, name: user.name }
  }
}

describe('session() + authorization', () => {
  test('login populates the principal for later authenticated requests', async () => {
    const app = await createApp({ controllers: [Acct], plugins: [session()] })

    // Unauthenticated: no session → deriver sets no principal → 401.
    const anon = await app.handle(new Request('http://t/acct/me'))
    expect(anon.status).toBe(401)

    // Log in, capture the session cookie.
    const login = await app.handle(
      new Request('http://t/acct/login', { method: 'POST' }),
    )
    const sid = sidFrom(login.headers.get('set-cookie'))
    expect(sid).toBeTruthy()

    // With the cookie the deriver loads the user and populates ctx (Auth.user).
    const me = await app.handle(
      new Request('http://t/acct/me', { headers: { cookie: `sid=${sid}` } }),
    )
    expect(me.status).toBe(200)
    expect(await me.json()).toEqual({ id: 'u1', name: 'Ada' })
  })
})

describe('memorySessionStore()', () => {
  test('expires entries past their ttl', async () => {
    const store = memorySessionStore({ ttl: -1 }) // already expired on write
    await store.set('k', { a: 1 })
    expect(await store.get('k')).toBeUndefined()
  })

  test('retains entries without a ttl', async () => {
    const store = memorySessionStore()
    await store.set('k', { a: 1 })
    expect(await store.get('k')).toEqual({ a: 1 })
    await store.destroy('k')
    expect(await store.get('k')).toBeUndefined()
  })
})
