import { describe, expect, test } from 'bun:test'
import {
  clearElevation,
  controller,
  createApp,
  elevate,
  get,
  getImpersonation,
  impersonate,
  post,
  requireStepUp,
  Session,
  session,
  stopImpersonation,
  use,
} from '../src'

// A module-level clock the requireStepUp guard reads via its closure.
let now = 2000

@controller('/s')
class S {
  @post('/elevate')
  doElevate() {
    elevate(new Session(), 1000)
    return { ok: true }
  }

  @post('/clear')
  doClear() {
    clearElevation(new Session())
    return { ok: true }
  }

  @get('/sensitive')
  @use(requireStepUp({ within: 5000, clock: () => now }))
  sensitive() {
    return { secret: true }
  }

  @post('/impersonate')
  startImp() {
    impersonate(new Session(), { actor: 'admin', target: 'user1' })
    return { ok: true }
  }

  @get('/whoami')
  who() {
    return getImpersonation(new Session()) ?? { none: true }
  }

  @post('/stop')
  stopImp() {
    stopImpersonation(new Session())
    return { ok: true }
  }
}

const sidFrom = (setCookie: string | null): string | undefined =>
  setCookie?.match(/sid=([^;]+)/)?.[1]

async function appWithSession() {
  return createApp({ controllers: [S], plugins: [session()] })
}

async function elevatedSid(app: Awaited<ReturnType<typeof appWithSession>>) {
  const res = await app.handle(
    new Request('http://t/s/elevate', { method: 'POST' }),
  )
  return sidFrom(res.headers.get('set-cookie'))
}

describe('requireStepUp()', () => {
  test('rejects a request with no step-up', async () => {
    now = 2000
    const app = await appWithSession()
    const res = await app.handle(new Request('http://t/s/sensitive'))
    expect(res.status).toBe(401)
  })

  test('allows a request within the step-up window', async () => {
    now = 2000 // age = 2000 - 1000 = 1000 < 5000
    const app = await appWithSession()
    const sid = await elevatedSid(app)
    const res = await app.handle(
      new Request('http://t/s/sensitive', {
        headers: { cookie: `sid=${sid}` },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ secret: true })
  })

  test('rejects a stale step-up', async () => {
    now = 2000
    const app = await appWithSession()
    const sid = await elevatedSid(app)
    now = 10_000 // age = 10000 - 1000 = 9000 > 5000
    const res = await app.handle(
      new Request('http://t/s/sensitive', {
        headers: { cookie: `sid=${sid}` },
      }),
    )
    expect(res.status).toBe(401)
  })

  test('rejects once the elevation is cleared', async () => {
    now = 2000
    const app = await appWithSession()
    const sid = await elevatedSid(app)
    await app.handle(
      new Request('http://t/s/clear', {
        method: 'POST',
        headers: { cookie: `sid=${sid}` },
      }),
    )
    const res = await app.handle(
      new Request('http://t/s/sensitive', {
        headers: { cookie: `sid=${sid}` },
      }),
    )
    expect(res.status).toBe(401)
  })
})

describe('impersonation', () => {
  test('records, reads back, and clears impersonation', async () => {
    const app = await appWithSession()
    const start = await app.handle(
      new Request('http://t/s/impersonate', { method: 'POST' }),
    )
    const sid = sidFrom(start.headers.get('set-cookie'))

    const who = await app.handle(
      new Request('http://t/s/whoami', { headers: { cookie: `sid=${sid}` } }),
    )
    expect(await who.json()).toEqual({ actor: 'admin', target: 'user1' })

    await app.handle(
      new Request('http://t/s/stop', {
        method: 'POST',
        headers: { cookie: `sid=${sid}` },
      }),
    )
    const after = await app.handle(
      new Request('http://t/s/whoami', { headers: { cookie: `sid=${sid}` } }),
    )
    expect(await after.json()).toEqual({ none: true })
  })
})
