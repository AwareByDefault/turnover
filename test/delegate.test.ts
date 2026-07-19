import { describe, expect, test } from 'bun:test'
import { type Context, controller, createApp, get } from '../src'

// A raw WinterTC handler (any framework's `.fetch` looks like this).
const echo = (req: Request) =>
  Response.json({ path: new URL(req.url).pathname, method: req.method })

@controller('/users')
class Users {
  @get('/:id')
  one(ctx: Context<{ id: string }>) {
    return { user: ctx.params.id }
  }
}

describe('WinterTC — app.fetch', () => {
  test('is a bound (Request) => Promise<Response> handler', async () => {
    const app = await createApp({ controllers: [Users] })
    const { fetch } = app // destructured — must stay bound to the app
    const res = await fetch(new Request('http://t/users/7'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: '7' })
  })
})

describe('WinterTC — app.delegate()', () => {
  test('hands a prefix to a raw handler, stripping the prefix', async () => {
    const app = await createApp({ controllers: [Users] })
    app.delegate('/legacy', echo)
    const res = await app.handle(new Request('http://t/legacy/orders/5'))
    expect(await res.json()).toEqual({ path: '/orders/5', method: 'GET' })
  })

  test("the app's own routes still work alongside a delegate", async () => {
    const app = await createApp({ controllers: [Users] })
    app.delegate('/legacy', echo)
    const res = await app.handle(new Request('http://t/users/1'))
    expect(await res.json()).toEqual({ user: '1' })
  })

  test('composes another Turnover app via its app.fetch', async () => {
    const sub = await createApp({ controllers: [Users] })
    const app = await createApp({ controllers: [] })
    app.delegate('/v2', sub.fetch)
    const res = await app.handle(new Request('http://t/v2/users/9'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: '9' })
  })

  test('the delegate owns its whole prefix (its response, not the app 404)', async () => {
    const app = await createApp({ controllers: [] })
    app.delegate('/legacy', echo)
    const res = await app.handle(new Request('http://t/legacy/anything'))
    expect(res.status).toBe(200)
    expect(await res.json()).toHaveProperty('path', '/anything')
  })

  test('preserves method and body through delegation', async () => {
    const bodyEcho = async (req: Request) =>
      Response.json({ got: await req.json(), method: req.method })
    const app = await createApp({ controllers: [] })
    app.delegate('/api', bodyEcho)
    const res = await app.handle(
      new Request('http://t/api/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"a":1}',
      }),
    )
    expect(await res.json()).toEqual({ got: { a: 1 }, method: 'POST' })
  })

  test('the longest matching prefix wins', async () => {
    const app = await createApp({ controllers: [] })
    app.delegate(
      '/api',
      (req) => new Response(`api:${new URL(req.url).pathname}`),
    )
    app.delegate(
      '/api/v2',
      (req) => new Response(`v2:${new URL(req.url).pathname}`),
    )
    expect(
      await (await app.handle(new Request('http://t/api/v2/x'))).text(),
    ).toBe('v2:/x')
    expect(
      await (await app.handle(new Request('http://t/api/v1/x'))).text(),
    ).toBe('api:/v1/x')
  })

  test('createApp({ delegate }) wires prefixes at construction', async () => {
    const app = await createApp({
      controllers: [],
      delegate: { '/legacy': echo },
    })
    const res = await app.handle(new Request('http://t/legacy/z'))
    expect(await res.json()).toEqual({ path: '/z', method: 'GET' })
  })
})
