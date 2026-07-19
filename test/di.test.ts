import { describe, expect, test } from 'bun:test'
import {
  Container,
  type Context,
  controller,
  createApp,
  get,
  inject,
  injectable,
} from '../src'

@injectable()
class Counter {
  private n = 0
  next() {
    this.n += 1
    return this.n
  }
}

@injectable({ scope: 'transient' })
class Ticket {
  readonly id = Math.random()
}

describe('Container scopes', () => {
  test('singletons are shared across resolves', () => {
    const c = new Container()
    expect(c.resolve(Counter)).toBe(c.resolve(Counter))
  })

  test('a singleton keeps state between resolutions', () => {
    const c = new Container()
    expect(c.resolve(Counter).next()).toBe(1)
    expect(c.resolve(Counter).next()).toBe(2)
  })

  test('transients produce a fresh instance every resolve', () => {
    const c = new Container()
    expect(c.resolve(Ticket)).not.toBe(c.resolve(Ticket))
  })

  test("separate containers don't share singletons", () => {
    expect(new Container().resolve(Counter)).not.toBe(
      new Container().resolve(Counter),
    )
  })
})

describe('inject()', () => {
  test('resolves a dependency in a field initializer', () => {
    @injectable()
    class Service {
      greet() {
        return 'hi'
      }
    }
    class Consumer {
      readonly svc = inject(Service)
    }
    const c = new Container()
    expect(c.resolve(Consumer).svc.greet()).toBe('hi')
  })

  test('a controller can inject a service and use it', async () => {
    @injectable()
    class Doubler {
      double(n: number) {
        return n * 2
      }
    }
    @controller('/math')
    class MathController {
      private readonly doubler = inject(Doubler)
      @get('/:n')
      go(ctx: Context<{ n: string }>) {
        return { result: this.doubler.double(Number(ctx.params.n)) }
      }
    }
    const app = await createApp({ controllers: [MathController] })
    const res = await app.handle(new Request('http://t/math/21'))
    expect(await res.json()).toEqual({ result: 42 })
  })

  test('throws when called outside an injection context', () => {
    @injectable()
    class Loose {}
    expect(() => inject(Loose)).toThrow(/outside an injection context/)
  })

  test('detects circular dependencies with a helpful message', () => {
    @injectable()
    class A {
      readonly b = inject(B)
    }
    @injectable()
    class B {
      readonly a = inject(A)
    }
    expect(() => new Container().resolve(A)).toThrow(/Circular dependency/)
  })
})
