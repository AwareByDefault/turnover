import { describe, expect, test } from 'bun:test'
import { controller, createApp, get } from '../src'

@controller('/users')
class Users {
  @get('/')
  list() {
    return []
  }
}

describe('app.docs()', () => {
  test('serves the OpenAPI spec at /openapi.json', async () => {
    const app = (await createApp({ controllers: [Users] })).docs()
    const res = await app.handle(new Request('http://t/openapi.json'))
    expect(res.status).toBe(200)
    const spec = (await res.json()) as {
      openapi: string
      paths: Record<string, unknown>
    }
    expect(spec.openapi).toMatch(/^3\./)
    expect(spec.paths['/users']).toBeDefined()
  })

  test('serves a docs UI at /docs pointing at the spec', async () => {
    const app = (await createApp({ controllers: [Users] })).docs()
    const res = await app.handle(new Request('http://t/docs'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('/openapi.json')
  })

  test('honors custom paths and can disable the UI', async () => {
    const app = (await createApp({ controllers: [Users] })).docs({
      jsonPath: '/spec',
      uiPath: false,
    })
    expect((await app.handle(new Request('http://t/spec'))).status).toBe(200)
    // UI disabled → /docs falls through to the router (404)
    expect((await app.handle(new Request('http://t/docs'))).status).toBe(404)
  })

  test('leaves other routes alone', async () => {
    const app = (await createApp({ controllers: [Users] })).docs()
    expect((await app.handle(new Request('http://t/users'))).status).toBe(200)
  })
})
