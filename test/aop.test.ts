import { beforeEach, describe, expect, test } from 'bun:test'
import {
  after,
  around,
  aspectProcessor,
  before,
  Container,
  controller,
  createApp,
  get,
  inject,
} from '../src'

const log: string[] = []
beforeEach(() => {
  log.length = 0
})

/** Resolve a class through a container with the aspect processor registered. */
function advised<T>(cls: new () => T): T {
  return new Container().addPostProcessor(aspectProcessor).resolve(cls)
}

describe('@before / @after', () => {
  test('before runs before the method; after runs after (sync)', () => {
    class Calc {
      @before((jp) => log.push(`before:${jp.method}(${jp.args.join(',')})`))
      @after(() => log.push('after'))
      add(a: number, b: number) {
        log.push('add')
        return a + b
      }
    }
    const calc = advised(Calc)
    expect(calc.add(2, 3)).toBe(5)
    expect(log).toEqual(['before:add(2,3)', 'add', 'after'])
  })

  test('after awaits an async method before running', async () => {
    class Svc {
      @after(() => log.push('after'))
      async work() {
        await Promise.resolve()
        log.push('work')
        return 1
      }
    }
    const s = advised(Svc)
    const p = s.work()
    expect(log).toEqual([]) // nothing yet — method is async
    await p
    expect(log).toEqual(['work', 'after']) // after ran once the promise settled
  })
})

describe('@around', () => {
  test('can transform the result', () => {
    class Doubler {
      @around((jp) => (jp.proceed() as number) * 2)
      value(n: number) {
        return n
      }
    }
    expect(advised(Doubler).value(5)).toBe(10)
  })

  test('can modify args passed to the method', () => {
    class Svc {
      @around((jp) => jp.proceed([(jp.args[0] as number) + 1]))
      echo(n: number) {
        return n
      }
    }
    expect(advised(Svc).echo(1)).toBe(2)
  })

  test('can short-circuit by not calling proceed()', () => {
    class Cache {
      @around(() => 'cached')
      compute() {
        log.push('computed')
        return 'fresh'
      }
    }
    expect(advised(Cache).compute()).toBe('cached')
    expect(log).not.toContain('computed')
  })

  test('can catch errors thrown by the method', () => {
    class Safe {
      @around((jp) => {
        try {
          return jp.proceed()
        } catch {
          return 'recovered'
        }
      })
      risky(): string {
        throw new Error('boom')
      }
    }
    expect(advised(Safe).risky()).toBe('recovered')
  })

  test('multiple around advice nest (first declared is outermost)', () => {
    class Svc {
      @around((jp) => {
        log.push('outer:before')
        const r = jp.proceed()
        log.push('outer:after')
        return r
      })
      @around((jp) => {
        log.push('inner:before')
        const r = jp.proceed()
        log.push('inner:after')
        return r
      })
      run() {
        log.push('run')
        return 1
      }
    }
    advised(Svc).run()
    expect(log).toEqual([
      'outer:before',
      'inner:before',
      'run',
      'inner:after',
      'outer:after',
    ])
  })
})

describe('proxy semantics', () => {
  test('self-invocation bypasses advice', () => {
    class SelfCall {
      @around(() => 'advised')
      helper() {
        return 'raw'
      }
      caller() {
        return this.helper() // internal call — not through the proxy
      }
    }
    const s = advised(SelfCall)
    expect(s.helper()).toBe('advised') // external call is advised
    expect(s.caller()).toBe('raw') // self-invocation bypasses
  })

  test('advised and non-advised methods can read #private fields', () => {
    class WithPrivate {
      #secret = 42
      @before(() => {})
      reveal() {
        return this.#secret
      }
      plain() {
        return this.#secret
      }
    }
    const w = advised(WithPrivate)
    expect(w.reveal()).toBe(42) // advised → runs against the raw target
    expect(w.plain()).toBe(42) // non-advised via proxy, still bound to target
  })

  test('classes without advice are not wrapped', () => {
    class Plain {
      go() {
        return 'ok'
      }
    }
    const c = new Container().addPostProcessor(aspectProcessor)
    // No advice metadata → aspectProcessor returns the instance unchanged.
    expect(c.resolve(Plain)).toBe(c.resolve(Plain))
  })
})

describe('createApp integration', () => {
  test('advice works on injected services with no manual setup', async () => {
    let calls = 0
    class TimingService {
      @around((jp) => {
        calls += 1
        return jp.proceed()
      })
      work() {
        return 'done'
      }
    }
    @controller('/svc')
    class SvcController {
      private readonly svc = inject(TimingService)
      @get('/')
      go() {
        return { result: this.svc.work() }
      }
    }
    const app = await createApp({ controllers: [SvcController] })
    const res = await app.handle(new Request('http://t/svc'))
    expect(await res.json()).toEqual({ result: 'done' })
    expect(calls).toBe(1) // the aspect processor is auto-registered
  })
})
