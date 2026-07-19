import { describe, expect, test } from 'bun:test'
import {
  Auth,
  apiKey,
  authenticated,
  authentication,
  bearer,
  controller,
  createApp,
  get,
  inject,
} from '../src'

const TOKENS: Record<string, { id: string; name: string; roles: string[] }> = {
  't-abc': { id: '1', name: 'Ada', roles: ['user'] },
}
const KEYS: Record<string, { id: string; name: string; roles: string[] }> = {
  'k-xyz': { id: '2', name: 'Svc', roles: ['service'] },
}

@controller('/me')
class Me {
  private readonly auth = inject(Auth)
  @get('/')
  @authenticated
  who() {
    return { id: (this.auth.user as { id: string }).id }
  }
  @get('/maybe')
  maybe() {
    return { authed: this.auth.isAuthenticated }
  }
}

function app() {
  return createApp({
    controllers: [Me],
    plugins: [
      authentication([
        bearer({ verify: (t) => TOKENS[t] ?? null }),
        apiKey({ verify: (k) => KEYS[k] ?? null }),
      ]),
    ],
  })
}

describe('authentication stage', () => {
  test('a bearer token sets the principal', async () => {
    const res = await (await app()).handle(
      new Request('http://t/me', {
        headers: { authorization: 'Bearer t-abc' },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: '1' })
  })

  test('an api key sets the principal (second scheme)', async () => {
    const res = await (await app()).handle(
      new Request('http://t/me', { headers: { 'x-api-key': 'k-xyz' } }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: '2' })
  })

  test('an unrecognized credential is anonymous → 401 on a guarded route', async () => {
    const res = await (await app()).handle(
      new Request('http://t/me', { headers: { authorization: 'Bearer nope' } }),
    )
    expect(res.status).toBe(401)
  })

  test('no credential is anonymous', async () => {
    const res = await (await app()).handle(new Request('http://t/me/maybe'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ authed: false })
  })
})
