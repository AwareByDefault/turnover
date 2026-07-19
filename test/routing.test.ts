import { describe, expect, test } from 'bun:test'
import {
  type Context,
  controller,
  createApp,
  del,
  get,
  patch,
  post,
  put,
} from '../src'

@controller('/things')
class ThingsController {
  @get('/')
  list() {
    return { things: ['a', 'b'] }
  }

  @post('/')
  async create(ctx: Context) {
    const body = await ctx.body<{ name: string }>()
    return Response.json({ created: body?.name ?? null }, { status: 201 })
  }

  @get('/:id')
  getOne(ctx: Context<{ id: string }>) {
    return { id: ctx.params.id }
  }

  @put('/:id')
  replace(ctx: Context<{ id: string }>) {
    return { replaced: ctx.params.id }
  }

  @patch('/:id')
  edit(ctx: Context<{ id: string }>) {
    return { edited: ctx.params.id }
  }

  @del('/:id')
  remove(ctx: Context<{ id: string }>) {
    return { deleted: ctx.params.id }
  }
}

@controller('/orgs')
class NestedController {
  @get('/:org/users/:id')
  member(ctx: Context<{ org: string; id: string }>) {
    return { org: ctx.params.org, id: ctx.params.id }
  }
}

@controller('/coerce')
class CoercionController {
  @get('/obj')
  obj() {
    return { ok: true }
  }

  @get('/str')
  str() {
    return 'plain text'
  }

  @get('/void')
  nothing() {
    return null
  }

  @get('/raw')
  raw() {
    return new Response('teapot', { status: 418, headers: { 'x-flag': '1' } })
  }
}

@controller('/search')
class SearchController {
  @get('/')
  search(ctx: Context) {
    return { q: ctx.query.get('q'), n: ctx.query.get('n') }
  }
}

const app = await createApp({
  controllers: [
    ThingsController,
    NestedController,
    CoercionController,
    SearchController,
  ],
})

describe('routing', () => {
  test('dispatches each HTTP verb to its handler', async () => {
    expect(await (await app.handle(req('GET', '/things'))).json()).toEqual({
      things: ['a', 'b'],
    })
    expect(await (await app.handle(req('PUT', '/things/7'))).json()).toEqual({
      replaced: '7',
    })
    expect(await (await app.handle(req('PATCH', '/things/7'))).json()).toEqual({
      edited: '7',
    })
    expect(await (await app.handle(req('DELETE', '/things/7'))).json()).toEqual(
      {
        deleted: '7',
      },
    )
  })

  test('captures a single path param', async () => {
    const res = await app.handle(req('GET', '/things/42'))
    expect(await res.json()).toEqual({ id: '42' })
  })

  test('captures multiple path params in nested segments', async () => {
    const res = await app.handle(req('GET', '/orgs/acme/users/9'))
    expect(await res.json()).toEqual({ org: 'acme', id: '9' })
  })

  test('url-decodes captured params', async () => {
    const res = await app.handle(req('GET', '/things/a%20b'))
    expect(await res.json()).toEqual({ id: 'a b' })
  })

  test('prefers a static route over a param route', async () => {
    // "/things/" normalizes to "/things" (static list), not "/things/:id".
    const res = await app.handle(req('GET', '/things/'))
    expect(await res.json()).toEqual({ things: ['a', 'b'] })
  })

  test('normalizes trailing slashes on params too', async () => {
    const res = await app.handle(req('GET', '/things/42/'))
    expect(await res.json()).toEqual({ id: '42' })
  })

  test('returns 404 for an unknown path', async () => {
    const res = await app.handle(req('GET', '/nope'))
    expect(res.status).toBe(404)
  })

  test('returns 405 with an Allow header for an unsupported method', async () => {
    const res = await app.handle(req('DELETE', '/things'))
    expect(res.status).toBe(405)
    const allow = res.headers.get('Allow')?.split(', ').sort()
    expect(allow).toEqual(['GET', 'POST'])
  })
})

describe('query string', () => {
  test('parses query params off the context', async () => {
    const res = await app.handle(req('GET', '/search?q=hi&n=2'))
    expect(await res.json()).toEqual({ q: 'hi', n: '2' })
  })

  test('missing query params read as null', async () => {
    const res = await app.handle(req('GET', '/search'))
    expect(await res.json()).toEqual({ q: null, n: null })
  })
})

describe('return-value coercion', () => {
  test('objects become JSON', async () => {
    const res = await app.handle(req('GET', '/coerce/obj'))
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ ok: true })
  })

  test('strings become text/plain', async () => {
    const res = await app.handle(req('GET', '/coerce/str'))
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(await res.text()).toBe('plain text')
  })

  test('null/undefined become 204 No Content', async () => {
    const res = await app.handle(req('GET', '/coerce/void'))
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  test('a returned Response is passed through untouched', async () => {
    const res = await app.handle(req('GET', '/coerce/raw'))
    expect(res.status).toBe(418)
    expect(res.headers.get('x-flag')).toBe('1')
    expect(await res.text()).toBe('teapot')
  })
})

describe('body parsing', () => {
  test('parses a JSON body', async () => {
    const res = await app.handle(
      new Request('http://t/things', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'widget' }),
      }),
    )
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ created: 'widget' })
  })

  test('an empty body reads as undefined', async () => {
    const res = await app.handle(req('POST', '/things'))
    expect(await res.json()).toEqual({ created: null })
  })
})

/** Build a GET-ish request against an in-memory origin. */
function req(method: string, path: string): Request {
  return new Request(`http://t${path}`, { method })
}
