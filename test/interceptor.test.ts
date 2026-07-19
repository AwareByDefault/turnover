import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type Context,
  controller,
  createApp,
  get,
  HttpError,
  type Interceptor,
  intercept,
  module,
} from '../src'

const trace: string[] = []
beforeEach(() => {
  trace.length = 0
})

/** An interceptor that records its before/after around `next()`. */
const mark =
  (label: string): Interceptor =>
  async (_ctx, next) => {
    trace.push(`${label}:before`)
    const res = await next()
    trace.push(`${label}:after`)
    return res
  }

@controller('/i')
@intercept(mark('class'))
class InterceptController {
  @get('/plain')
  @intercept(mark('method'))
  plain() {
    trace.push('handler')
    return { ok: true }
  }

  @get('/transform')
  @intercept(async (_ctx, next) => {
    const res = await next()
    res.headers.set('x-wrapped', '1')
    return res
  })
  transform() {
    return { ok: true }
  }

  @get('/short')
  @intercept(async () => new Response('short', { status: 299 }))
  short() {
    trace.push('handler')
    return { ok: true }
  }

  @get('/catch')
  @intercept(async (_ctx, next) => {
    try {
      return await next()
    } catch {
      return new Response('caught', { status: 500 })
    }
  })
  boom() {
    throw new HttpError(418, 'teapot')
  }
}

@controller('/ctx')
class CtxController {
  @get('/:id')
  @intercept(async (ctx, next) => {
    trace.push(`id=${ctx.params.id}`)
    return next()
  })
  route(ctx: Context) {
    return { id: ctx.params.id }
  }
}

const app = await createApp({
  controllers: [InterceptController, CtxController],
})

describe('@intercept (around advice)', () => {
  test('wraps the handler, controller outside method (LIFO on the way out)', async () => {
    await app.handle(new Request('http://t/i/plain'))
    expect(trace).toEqual([
      'class:before',
      'method:before',
      'handler',
      'method:after',
      'class:after',
    ])
  })

  test('can transform the response after next()', async () => {
    const res = await app.handle(new Request('http://t/i/transform'))
    expect(res.headers.get('x-wrapped')).toBe('1')
  })

  test('can short-circuit by not calling next()', async () => {
    const res = await app.handle(new Request('http://t/i/short'))
    expect(res.status).toBe(299)
    expect(await res.text()).toBe('short')
    expect(trace).not.toContain('handler')
  })

  test('can catch errors thrown by next()', async () => {
    const res = await app.handle(new Request('http://t/i/catch'))
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('caught')
  })

  test('sees the request context', async () => {
    const res = await app.handle(new Request('http://t/ctx/42'))
    expect(trace).toContain('id=42')
    expect(await res.json()).toEqual({ id: '42' })
  })
})

@controller('/m')
class ModRouteController {
  @get('/')
  @intercept(mark('route'))
  route() {
    trace.push('handler')
    return { ok: true }
  }
}

@module({ intercept: [mark('module')], controllers: [ModRouteController] })
class InterceptModule {}

describe('module interceptors', () => {
  test('wrap outside controller/route interceptors', async () => {
    const modApp = await createApp({ modules: [InterceptModule] })
    await modApp.handle(new Request('http://t/m'))
    expect(trace).toEqual([
      'module:before',
      'route:before',
      'handler',
      'route:after',
      'module:after',
    ])
  })
})
