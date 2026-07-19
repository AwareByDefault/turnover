import { describe, expect, test } from 'bun:test'
import {
  CONFIG_SOURCE,
  type ConfigSource,
  ConfigValidationError,
  Container,
  configProperties,
  controller,
  createApp,
  get,
  inject,
  type StandardIssue,
  type StandardSchemaV1,
} from '../src'

/** A hand-rolled, synchronous Standard Schema (no validator dependency). */
const PortDb: StandardSchemaV1 = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate(input: unknown) {
      const o = (input ?? {}) as Record<string, string | undefined>
      const issues: StandardIssue[] = []
      const port = Number(o.port)
      if (o.port === undefined || Number.isNaN(port)) {
        issues.push({ message: 'must be a number', path: ['port'] })
      }
      if (!o.databaseUrl) {
        issues.push({ message: 'is required', path: ['databaseUrl'] })
      }
      if (issues.length > 0) return { issues }
      return { value: { port, databaseUrl: o.databaseUrl } }
    },
  },
}

function source(vars: Record<string, string>): ConfigSource {
  return { get: (key) => vars[key], entries: () => Object.entries(vars) }
}

/** Resolve a config class through a container backed by `vars`. */
function load<T>(cls: new () => T, vars: Record<string, string>): T {
  const container = new Container()
  container.register(CONFIG_SOURCE, { useValue: source(vars) })
  return container.resolve(cls)
}

describe('@configProperties', () => {
  test('binds SCREAMING_SNAKE env to camelCase fields, coerced by the schema', () => {
    @configProperties(PortDb)
    class Settings {
      port!: number
      databaseUrl!: string
    }
    const s = load(Settings, { PORT: '3000', DATABASE_URL: 'postgres://db' })
    expect(s.port).toBe(3000)
    expect(s.databaseUrl).toBe('postgres://db')
  })

  test('throws ConfigValidationError with field paths when invalid', () => {
    @configProperties(PortDb)
    class Settings {
      port!: number
      databaseUrl!: string
    }
    expect(() => load(Settings, { PORT: 'not-a-number' })).toThrow(
      ConfigValidationError,
    )
    try {
      load(Settings, { PORT: 'x' })
      expect.unreachable('should have thrown')
    } catch (err) {
      const e = err as ConfigValidationError
      expect(e.message).toContain('port')
      expect(e.message).toContain('databaseUrl')
      expect(e.issues).toHaveLength(2)
    }
  })

  test('honors a prefix, stripping it and ignoring other vars', () => {
    @configProperties(PortDb, { prefix: 'APP_' })
    class Settings {
      port!: number
      databaseUrl!: string
    }
    const s = load(Settings, {
      APP_PORT: '8080',
      APP_DATABASE_URL: 'x',
      OTHER_PORT: '1',
    })
    expect(s.port).toBe(8080)
    expect(s.databaseUrl).toBe('x')
  })

  test('resolves as a singleton', () => {
    @configProperties(PortDb)
    class Settings {
      port!: number
      databaseUrl!: string
    }
    const container = new Container()
    container.register(CONFIG_SOURCE, {
      useValue: source({ PORT: '1', DATABASE_URL: 'x' }),
    })
    expect(container.resolve(Settings)).toBe(container.resolve(Settings))
  })

  test('rejects an asynchronous schema', () => {
    const AsyncSchema: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: async (v: unknown) => ({ value: v }),
      },
    }
    @configProperties(AsyncSchema)
    class Settings {}
    expect(() => load(Settings, {})).toThrow(/synchronous/)
  })

  test('binds through createApp({ config }) into a controller (fails fast at boot)', async () => {
    @configProperties(PortDb)
    class Settings {
      port!: number
      databaseUrl!: string
    }
    @controller('/cfg')
    class CfgController {
      private readonly settings = inject(Settings)
      @get('/')
      read() {
        return { port: this.settings.port }
      }
    }
    const app = await createApp({
      controllers: [CfgController],
      config: { PORT: '9090', DATABASE_URL: 'x' },
    })
    const res = await app.handle(new Request('http://t/cfg'))
    expect(await res.json()).toEqual({ port: 9090 })
  })
})
