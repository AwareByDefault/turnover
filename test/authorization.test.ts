import { describe, expect, test } from 'bun:test'
import {
  authenticated,
  authorize,
  controller,
  createApp,
  type Guard,
  get,
  requireRole,
  requireScope,
  setPrincipal,
  use,
} from '../src'

const USERS: Record<
  string,
  { id: string; name: string; roles: string[]; scopes: string[] }
> = {
  admin: { id: '1', name: 'Admin', roles: ['admin'], scopes: ['orders:read'] },
  user: { id: '2', name: 'User', roles: ['user'], scopes: [] },
}

/** Class-level authenticator: sets the principal from the Authorization header. */
const authenticator: Guard = (ctx) => {
  const token = ctx.req.headers.get('authorization') ?? ''
  const user = USERS[token]
  if (user) setPrincipal(user)
}

@controller('/api')
@use(authenticator)
class Api {
  @get('/admin')
  @requireRole('admin')
  admin() {
    return { ok: true }
  }
  @get('/me')
  @authenticated
  me() {
    return { ok: true }
  }
  @get('/orders')
  @requireScope('orders:read')
  orders() {
    return []
  }
  @get('/own/:id')
  @authorize((user, ctx) => (user as { id?: string }).id === ctx.params.id)
  own() {
    return { ok: true }
  }
}

async function callApp(path: string, token?: string) {
  const app = await createApp({ controllers: [Api] })
  const headers = token ? { authorization: token } : undefined
  return app.handle(new Request(`http://t${path}`, { headers }))
}

describe('authorization decorators', () => {
  test('@authenticated: 200 with a principal, 401 without', async () => {
    expect((await callApp('/api/me', 'user')).status).toBe(200)
    expect((await callApp('/api/me')).status).toBe(401)
  })

  test('@requireRole: 200 for the role, 403 without it, 401 anonymous', async () => {
    expect((await callApp('/api/admin', 'admin')).status).toBe(200)
    expect((await callApp('/api/admin', 'user')).status).toBe(403)
    expect((await callApp('/api/admin')).status).toBe(401)
  })

  test('@requireScope: 200 with the scope, 403 without', async () => {
    expect((await callApp('/api/orders', 'admin')).status).toBe(200)
    expect((await callApp('/api/orders', 'user')).status).toBe(403)
  })

  test('@authorize: 200 when the policy passes, 403 when it fails', async () => {
    // user id "2" may read its own resource
    expect((await callApp('/api/own/2', 'user')).status).toBe(200)
    expect((await callApp('/api/own/9', 'user')).status).toBe(403)
  })
})
