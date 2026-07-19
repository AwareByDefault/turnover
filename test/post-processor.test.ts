import { beforeEach, describe, expect, test } from 'bun:test'
import {
  Container,
  type Ctor,
  controller,
  createApp,
  get,
  type PostProcessor,
} from '../src'

const calls: string[] = []
beforeEach(() => {
  calls.length = 0
})

/** A processor that wraps every method call in a logging Proxy. */
const logging: PostProcessor = (instance, token) =>
  new Proxy(instance, {
    get(target, prop, receiver) {
      const val = Reflect.get(target, prop, receiver)
      if (typeof val === 'function') {
        return (...args: unknown[]) => {
          calls.push(`${token.name}.${String(prop)}`)
          return (val as (...a: unknown[]) => unknown).apply(target, args)
        }
      }
      return val
    },
  })

describe('Container post-processors', () => {
  test('wrap a constructed instance', () => {
    const c = new Container()
    c.addPostProcessor(logging)
    class Svc {
      hello() {
        return 'hi'
      }
    }
    const s = c.resolve(Svc)
    expect(s.hello()).toBe('hi') // wrapper is transparent
    expect(calls).toContain('Svc.hello')
  })

  test('the wrapper is cached (same instance across resolves)', () => {
    const c = new Container()
    c.addPostProcessor(logging) // returns a new Proxy each call if not cached
    class Svc {}
    expect(c.resolve(Svc)).toBe(c.resolve(Svc))
  })

  test('processors chain in registration order', () => {
    const order: string[] = []
    const c = new Container()
    c.addPostProcessor((i) => {
      order.push('a')
      return i
    })
    c.addPostProcessor((i) => {
      order.push('b')
      return i
    })
    class Svc {}
    c.resolve(Svc)
    expect(order).toEqual(['a', 'b'])
  })

  test('a processor can wrap selectively by token', () => {
    const c = new Container()
    const tagOverride: PostProcessor = (instance, token: Ctor) =>
      token.name === 'Advised'
        ? new Proxy(instance, {
            get: (t, p, r) => (p === 'tag' ? 'advised' : Reflect.get(t, p, r)),
          })
        : instance
    c.addPostProcessor(tagOverride)
    class Advised {
      tag = 'raw'
    }
    class Plain {
      tag = 'raw'
    }
    expect((c.resolve(Advised) as { tag: string }).tag).toBe('advised')
    expect((c.resolve(Plain) as { tag: string }).tag).toBe('raw')
  })

  test('processors see the fully-constructed instance', () => {
    const c = new Container()
    let observed: unknown
    c.addPostProcessor((i) => {
      observed = (i as { ready?: boolean }).ready
      return i
    })
    class Svc {
      ready = true
    }
    c.resolve(Svc)
    expect(observed).toBe(true)
  })
})

describe('createApp({ postProcessors })', () => {
  test('wraps controllers and their handlers', async () => {
    @controller('/x')
    class XController {
      @get('/')
      go() {
        return { ok: true }
      }
    }
    const app = await createApp({
      controllers: [XController],
      postProcessors: [logging],
    })
    const res = await app.handle(new Request('http://t/x'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(calls).toContain('XController.go') // the handler call went through the proxy
  })
})
