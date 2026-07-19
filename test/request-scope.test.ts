import { describe, expect, test } from 'bun:test'
import {
  controller,
  createApp,
  get,
  inject,
  injectable,
  postConstruct,
} from '../src'

let idCounter = 0
const nextId = () => {
  idCounter += 1
  return idCounter
}
@injectable({ scope: 'request' })
class RequestId {
  readonly value = nextId()
}

// Two singletons, each injecting the request-scoped bean.
@injectable()
class ServiceA {
  private readonly rid = inject(RequestId)
  id() {
    return this.rid.value
  }
}
@injectable()
class ServiceB {
  private readonly rid = inject(RequestId)
  id() {
    return this.rid.value
  }
}

@controller('/rs')
class RsController {
  private readonly a = inject(ServiceA)
  private readonly b = inject(ServiceB)
  @get('/')
  go() {
    return { a: this.a.id(), b: this.b.id() }
  }
}

describe('request scope', () => {
  test('one instance per request (shared across injections), fresh each request', async () => {
    idCounter = 0
    const app = await createApp({ controllers: [RsController] })
    const r1 = (await (
      await app.handle(new Request('http://t/rs'))
    ).json()) as {
      a: number
      b: number
    }
    const r2 = (await (
      await app.handle(new Request('http://t/rs'))
    ).json()) as {
      a: number
      b: number
    }
    expect(r1.a).toBe(r1.b) // same instance within request 1 (via two singletons)
    expect(r2.a).toBe(r2.b) // same instance within request 2
    expect(r1.a).not.toBe(r2.a) // different instance across requests
  })

  test('is lazy — not constructed until first used in a request', async () => {
    let inits = 0
    @injectable({ scope: 'request' })
    class Scoped {
      ready = false
      @postConstruct
      init() {
        inits += 1
        this.ready = true
      }
    }
    @controller('/sc')
    class ScController {
      private readonly s = inject(Scoped)
      @get('/')
      go() {
        return { ready: this.s.ready }
      }
    }

    const app = await createApp({ controllers: [ScController] })
    expect(inits).toBe(0) // not built at mount

    const res = await app.handle(new Request('http://t/sc'))
    expect(await res.json()).toEqual({ ready: true })
    expect(inits).toBe(1)

    await app.handle(new Request('http://t/sc'))
    expect(inits).toBe(2) // @postConstruct runs per request (fresh instance)
  })
})
