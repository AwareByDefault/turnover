import { describe, expect, test } from 'bun:test'
import { type Context, controller, createApp, del, get, post } from '../src'
import { testClient } from '../src/testing'

@controller('/api')
class Api {
  @get('/ping')
  ping(ctx: Context) {
    return {
      ok: true,
      n: ctx.query.get('n'),
      auth: ctx.req.headers.get('authorization'),
    }
  }

  @post('/echo')
  async echo(ctx: Context) {
    const body = await ctx.body()
    ctx.set.status = 201
    return { received: body }
  }

  @post('/raw')
  async raw(ctx: Context) {
    return { text: await ctx.body<string>() }
  }

  @del('/thing/:id')
  remove(ctx: Context) {
    return { deleted: ctx.params.id }
  }
}

async function client(headers?: Record<string, string>) {
  const app = await createApp({ controllers: [Api] })
  return testClient(app, headers ? { headers } : undefined)
}

describe('testClient()', () => {
  test('sends a GET with query params and default headers', async () => {
    const c = await client({ authorization: 'Bearer t' })
    const res = await c.get('/api/ping', { query: { n: 5 } })
    expect(res.status).toBe(200)
    expect(
      await res.json<{ ok: boolean; n: string | null; auth: string | null }>(),
    ).toEqual({ ok: true, n: '5', auth: 'Bearer t' })
  })

  test('serializes a JSON body and sets content-type', async () => {
    const c = await client()
    const res = await c.post('/api/echo', { name: 'Ada' })
    expect(res.status).toBe(201)
    expect(await res.json<{ received: { name: string } }>()).toEqual({
      received: { name: 'Ada' },
    })
  })

  test('passes a string body through untouched', async () => {
    const c = await client()
    const res = await c.post('/api/raw', 'hello', {
      headers: { 'content-type': 'text/plain' },
    })
    expect(await res.json<{ text: string }>()).toEqual({ text: 'hello' })
  })

  test('the response is re-readable across accessors', async () => {
    const c = await client()
    const res = await c.get('/api/ping')
    const first = await res.json()
    const second = await res.json()
    expect(first).toEqual(second)
    expect(await res.text()).toContain('"ok":true')
  })

  test('per-request headers override the client defaults', async () => {
    const c = await client({ authorization: 'Bearer default' })
    const res = await c.get('/api/ping', {
      headers: { authorization: 'Bearer override' },
    })
    expect(((await res.json()) as { auth: string }).auth).toBe(
      'Bearer override',
    )
  })

  test('supports DELETE with a path param', async () => {
    const c = await client()
    const res = await c.delete('/api/thing/42')
    expect(await res.json<{ deleted: string }>()).toEqual({ deleted: '42' })
  })

  test('exposes status and headers directly', async () => {
    const c = await client()
    const res = await c.get('/api/ping')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})
