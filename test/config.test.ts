import { describe, expect, test } from 'bun:test'
import {
  CONFIG_SOURCE,
  Config,
  type ConfigSource,
  Container,
  controller,
  createApp,
  get,
  inject,
  module,
  profile,
  value,
} from '../src'

function containerWith(cfg: Record<string, string>): Container {
  const c = new Container()
  c.register(CONFIG_SOURCE, { useValue: { get: (k: string) => cfg[k] } })
  return c
}

describe('Config', () => {
  test("get() coerces to the fallback's type", () => {
    const cfg = containerWith({
      PORT: '8080',
      DEBUG: 'true',
      NAME: 'svc',
    }).resolve(Config)
    expect(cfg.get('PORT', 3000)).toBe(8080) // number
    expect(cfg.get('DEBUG', false)).toBe(true) // boolean
    expect(cfg.get('NAME', 'x')).toBe('svc') // string
    expect(cfg.get('MISSING', 42)).toBe(42) // fallback
    expect(cfg.get('MISSING')).toBeUndefined() // no fallback
  })

  test('number coercion falls back on NaN', () => {
    expect(
      containerWith({ PORT: 'nope' }).resolve(Config).get('PORT', 3000),
    ).toBe(3000)
  })

  test("boolean coercion: only 'true'/'1' are true", () => {
    const cfg = containerWith({ A: '1', B: '0', C: 'yes' }).resolve(Config)
    expect(cfg.get('A', false)).toBe(true)
    expect(cfg.get('B', false)).toBe(false)
    expect(cfg.get('C', false)).toBe(false)
  })

  test('require() throws when missing; has() reflects presence', () => {
    const cfg = containerWith({ SET: 'v' }).resolve(Config)
    expect(cfg.require('SET')).toBe('v')
    expect(() => cfg.require('NOPE')).toThrow(/Missing required config/)
    expect(cfg.has('SET')).toBe(true)
    expect(cfg.has('NOPE')).toBe(false)
  })

  test('falls back to Bun.env when no source is registered', () => {
    ;(Bun.env as Record<string, string | undefined>).TURNOVER_TEST_KEY =
      'from-env'
    try {
      expect(new Container().resolve(Config).get('TURNOVER_TEST_KEY')).toBe(
        'from-env',
      )
    } finally {
      delete (Bun.env as Record<string, string | undefined>).TURNOVER_TEST_KEY
    }
  })
})

describe('value() helper & createApp({ config })', () => {
  test('value() reads config in a field initializer (coerced)', async () => {
    @controller('/cfg')
    class CfgController {
      private readonly port = value('PORT', 3000)
      @get('/')
      show() {
        return { port: this.port }
      }
    }
    const app = await createApp({
      controllers: [CfgController],
      config: { PORT: '9090' },
    })
    expect(
      await (await app.handle(new Request('http://t/cfg'))).json(),
    ).toEqual({
      port: 9090,
    })
  })

  test('config accepts a ConfigSource object', async () => {
    @controller('/src')
    class SrcController {
      private readonly v = value('K', 'def')
      @get('/')
      show() {
        return { v: this.v }
      }
    }
    const source: ConfigSource = { get: (k) => (k === 'K' ? 'src' : undefined) }
    const app = await createApp({
      controllers: [SrcController],
      config: source,
    })
    expect(
      await (await app.handle(new Request('http://t/src'))).json(),
    ).toEqual({
      v: 'src',
    })
  })
})

describe('@profile gating', () => {
  test('a controller mounts only when its profile is active', async () => {
    @profile('dev')
    @controller('/debug')
    class DebugController {
      @get('/')
      ok() {
        return { ok: true }
      }
    }
    const dev = await createApp({
      controllers: [DebugController],
      profiles: ['dev'],
    })
    expect((await dev.handle(new Request('http://t/debug'))).status).toBe(200)
    const prod = await createApp({
      controllers: [DebugController],
      profiles: ['prod'],
    })
    expect((await prod.handle(new Request('http://t/debug'))).status).toBe(404)
  })

  test('no @profile → always mounted', async () => {
    @controller('/always')
    class AlwaysController {
      @get('/')
      ok() {
        return { ok: true }
      }
    }
    const app = await createApp({
      controllers: [AlwaysController],
      profiles: ['prod'],
    })
    expect((await app.handle(new Request('http://t/always'))).status).toBe(200)
  })

  test('@profile matches any of several names', async () => {
    @profile('dev', 'test')
    @controller('/multi')
    class MultiController {
      @get('/')
      ok() {
        return { ok: true }
      }
    }
    const app = await createApp({
      controllers: [MultiController],
      profiles: ['test'],
    })
    expect((await app.handle(new Request('http://t/multi'))).status).toBe(200)
  })

  test('Config.hasProfile reflects the active profiles', async () => {
    @controller('/p')
    class PController {
      private readonly cfg = inject(Config)
      @get('/')
      show() {
        return {
          dev: this.cfg.hasProfile('dev'),
          prod: this.cfg.hasProfile('prod'),
        }
      }
    }
    const app = await createApp({
      controllers: [PController],
      profiles: ['dev'],
    })
    expect(await (await app.handle(new Request('http://t/p'))).json()).toEqual({
      dev: true,
      prod: false,
    })
  })

  test('@profile on a module gates the whole module', async () => {
    @controller('/inner')
    class InnerController {
      @get('/')
      ok() {
        return { ok: true }
      }
    }
    @profile('dev')
    @module({ prefix: '/mod', controllers: [InnerController] })
    class DevModule {}

    const prod = await createApp({ modules: [DevModule], profiles: ['prod'] })
    expect((await prod.handle(new Request('http://t/mod/inner'))).status).toBe(
      404,
    )
    const dev = await createApp({ modules: [DevModule], profiles: ['dev'] })
    expect((await dev.handle(new Request('http://t/mod/inner'))).status).toBe(
      200,
    )
  })
})
