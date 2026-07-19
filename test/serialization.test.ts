import { describe, expect, test } from 'bun:test'
import {
  type BodyParser,
  type Context,
  controller,
  createApp,
  get,
  post,
  type ResponseSerializer,
} from '../src'

@controller('/p')
class ParseController {
  @post('/')
  async create(ctx: Context) {
    return { parsed: await ctx.body() }
  }
}

describe('body parsers', () => {
  const csv: BodyParser = {
    contentTypes: ['text/csv'],
    async parse(req) {
      return (await req.text()).split(',').map((s) => s.trim())
    },
  }
  const shout: BodyParser = {
    contentTypes: ['text/*'], // subtype wildcard
    async parse(req) {
      return (await req.text()).toUpperCase()
    },
  }

  test('a registered parser handles its content type', async () => {
    const app = await createApp({
      controllers: [ParseController],
      parsers: [csv],
    })
    const res = await app.handle(
      new Request('http://t/p', {
        method: 'POST',
        headers: { 'content-type': 'text/csv' },
        body: 'a, b, c',
      }),
    )
    expect(await res.json()).toEqual({ parsed: ['a', 'b', 'c'] })
  })

  test('falls back to the JSON default when nothing matches', async () => {
    const app = await createApp({
      controllers: [ParseController],
      parsers: [csv],
    })
    const res = await app.handle(
      new Request('http://t/p', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x: 1 }),
      }),
    )
    expect(await res.json()).toEqual({ parsed: { x: 1 } })
  })

  test('a subtype wildcard matches', async () => {
    const app = await createApp({
      controllers: [ParseController],
      parsers: [shout],
    })
    const res = await app.handle(
      new Request('http://t/p', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'hello',
      }),
    )
    expect(await res.json()).toEqual({ parsed: 'HELLO' })
  })
})

@controller('/s')
class SerController {
  @get('/obj')
  obj() {
    return { id: 1 }
  }

  @get('/str')
  str() {
    return 'plain'
  }

  @get('/raw')
  raw() {
    return new Response('untouched', { status: 201 })
  }

  @get('/stream')
  stream() {
    return new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('chunked'))
        c.close()
      },
    })
  }
}

describe('response serializers', () => {
  const envelope: ResponseSerializer = {
    serialize(value) {
      if (
        value !== null &&
        typeof value === 'object' &&
        !(value instanceof ReadableStream)
      ) {
        return Response.json({ data: value })
      }
      return undefined // defer for non-objects
    },
  }
  const streamer: ResponseSerializer = {
    serialize(value) {
      return value instanceof ReadableStream ? new Response(value) : undefined
    },
  }
  const xml: ResponseSerializer = {
    serialize(value, ctx) {
      if (ctx.req.headers.get('accept')?.includes('application/xml')) {
        return new Response(`<v>${JSON.stringify(value)}</v>`, {
          headers: { 'content-type': 'application/xml' },
        })
      }
      return undefined
    },
  }

  test('wraps a value (envelope)', async () => {
    const app = await createApp({
      controllers: [SerController],
      serializers: [envelope],
    })
    expect(
      await (await app.handle(new Request('http://t/s/obj'))).json(),
    ).toEqual({
      data: { id: 1 },
    })
  })

  test('a serializer that defers falls to the default', async () => {
    const app = await createApp({
      controllers: [SerController],
      serializers: [envelope],
    })
    const res = await app.handle(new Request('http://t/s/str'))
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(await res.text()).toBe('plain') // not wrapped
  })

  test('serializers do not run on a returned Response', async () => {
    const app = await createApp({
      controllers: [SerController],
      serializers: [envelope],
    })
    const res = await app.handle(new Request('http://t/s/raw'))
    expect(res.status).toBe(201)
    expect(await res.text()).toBe('untouched')
  })

  test('content negotiation via the Accept header', async () => {
    const app = await createApp({
      controllers: [SerController],
      serializers: [xml],
    })
    const asXml = await app.handle(
      new Request('http://t/s/obj', { headers: { accept: 'application/xml' } }),
    )
    expect(asXml.headers.get('content-type')).toContain('application/xml')
    expect(await asXml.text()).toBe('<v>{"id":1}</v>')
    const asJson = await app.handle(new Request('http://t/s/obj'))
    expect(await asJson.json()).toEqual({ id: 1 }) // default
  })

  test('a streaming serializer handles a ReadableStream return', async () => {
    const app = await createApp({
      controllers: [SerController],
      serializers: [streamer],
    })
    const res = await app.handle(new Request('http://t/s/stream'))
    expect(await res.text()).toBe('chunked')
  })

  test('a plugin can contribute a serializer', async () => {
    const app = await createApp({
      controllers: [SerController],
      plugins: [{ serializers: [envelope] }],
    })
    expect(
      await (await app.handle(new Request('http://t/s/obj'))).json(),
    ).toEqual({
      data: { id: 1 },
    })
  })
})
