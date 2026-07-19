import { beforeEach, describe, expect, test } from 'bun:test'
import {
  controller,
  createApp,
  defineMacro,
  get,
  inject,
  injectable,
  macro,
} from '../src'

const trace: string[] = []
beforeEach(() => {
  trace.length = 0
})

@injectable()
class Greeter {
  greet() {
    return 'hi-from-service'
  }
}

// Macros are registered once, at module load.
defineMacro('mark', (label: string) => ({
  use: [
    () => {
      trace.push(`guard:${label}`)
    },
  ],
}))
defineMacro('deny', () => ({
  use: [() => new Response('denied', { status: 403 })],
}))
defineMacro('logger', () => ({
  derive: [
    (ctx) => {
      trace.push(`derive:${ctx.req.method}`)
    },
  ],
}))
defineMacro('timed', () => ({
  intercept: [
    (_ctx, next) => {
      trace.push('intercept:before')
      const r = next()
      trace.push('intercept:after')
      return r
    },
  ],
}))
// The fusion: a macro that injects a service at expansion time.
defineMacro('greet', () => {
  const greeter = inject(Greeter)
  return {
    intercept: [
      (_ctx, next) => {
        trace.push(greeter.greet())
        return next()
      },
    ],
  }
})

@controller('/m')
@macro('mark', 'class')
class MacroController {
  @get('/a')
  @macro('mark', 'method')
  a() {
    trace.push('handler')
    return { ok: true }
  }

  @get('/deny')
  @macro('deny')
  denied() {
    trace.push('handler')
    return { ok: true }
  }

  @get('/derive')
  @macro('logger')
  derived() {
    return { ok: true }
  }

  @get('/timed')
  @macro('timed')
  timed() {
    trace.push('handler')
    return { ok: true }
  }

  @get('/di')
  @macro('greet')
  di() {
    trace.push('handler')
    return { ok: true }
  }
}

const app = await createApp({ controllers: [MacroController] })
const GET = (path: string) => app.handle(new Request(`http://t${path}`))

describe('macros', () => {
  test('a parameterized macro guard runs; class- and method-level both apply', async () => {
    const res = await GET('/m/a')
    expect(res.status).toBe(200)
    expect(trace).toEqual(['guard:class', 'guard:method', 'handler'])
  })

  test('a macro guard can short-circuit', async () => {
    const res = await GET('/m/deny')
    expect(res.status).toBe(403)
    expect(await res.text()).toBe('denied')
    expect(trace).not.toContain('handler')
  })

  test('a macro can contribute a deriver', async () => {
    await GET('/m/derive')
    expect(trace).toContain('derive:GET')
  })

  test('a macro can contribute an interceptor (wraps the handler)', async () => {
    await GET('/m/timed')
    expect(trace).toEqual([
      'guard:class',
      'intercept:before',
      'handler',
      'intercept:after',
    ])
  })

  test('a macro can inject a service at mount (the fusion)', async () => {
    await GET('/m/di')
    expect(trace).toContain('hi-from-service')
  })
})

describe('composition & errors', () => {
  test('multiple macros on one route all apply', async () => {
    @controller('/multi')
    class MultiController {
      @get('/')
      @macro('mark', 'one')
      @macro('mark', 'two')
      go() {
        trace.push('handler')
        return { ok: true }
      }
    }
    const multi = await createApp({ controllers: [MultiController] })
    await multi.handle(new Request('http://t/multi'))
    expect(trace).toContain('guard:one')
    expect(trace).toContain('guard:two')
    expect(trace).toContain('handler')
  })

  test('an unknown macro throws at mount', async () => {
    @controller('/bad')
    @macro('does-not-exist')
    class BadController {
      @get('/')
      go() {
        return { ok: true }
      }
    }
    await expect(createApp({ controllers: [BadController] })).rejects.toThrow(
      /Unknown macro/,
    )
  })
})
