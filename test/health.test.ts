import { describe, expect, test } from 'bun:test'
import {
  createApp,
  HEALTH_CHECK,
  type HealthCheck,
  health,
  inject,
  injectable,
} from '../src'

describe('health()', () => {
  test('/health answers 200 up (liveness)', async () => {
    const app = await createApp({ controllers: [], plugins: [health()] })
    const res = await app.handle(new Request('http://t/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'up' })
  })

  test('/ready answers 200 with a per-check breakdown when all pass', async () => {
    const app = await createApp({
      controllers: [],
      plugins: [
        health({
          checks: [
            { name: 'db', check: () => true },
            { name: 'cache', check: async () => true },
          ],
        }),
      ],
    })
    const res = await app.handle(new Request('http://t/ready'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: 'up',
      checks: [
        { name: 'db', status: 'up' },
        { name: 'cache', status: 'up' },
      ],
    })
  })

  test('/ready answers 503 when a check returns falsy or throws', async () => {
    const app = await createApp({
      controllers: [],
      plugins: [
        health({
          checks: [
            { name: 'db', check: () => true },
            {
              name: 'broken',
              check: () => {
                throw new Error('down')
              },
            },
            { name: 'cold', check: () => false },
          ],
        }),
      ],
    })
    const res = await app.handle(new Request('http://t/ready'))
    expect(res.status).toBe(503)
    const body = (await res.json()) as {
      status: string
      checks: Array<{ name: string; status: string }>
    }
    expect(body.status).toBe('down')
    expect(body.checks).toContainEqual({ name: 'broken', status: 'down' })
    expect(body.checks).toContainEqual({ name: 'cold', status: 'down' })
  })

  test('honors custom paths and leaves other routes to the router', async () => {
    const app = await createApp({
      controllers: [],
      plugins: [health({ livenessPath: '/healthz', readinessPath: '/readyz' })],
    })
    expect((await app.handle(new Request('http://t/healthz'))).status).toBe(200)
    // a non-probe path is not intercepted → 404 from the router
    expect((await app.handle(new Request('http://t/nope-xyz'))).status).toBe(
      404,
    )
  })

  test('collects HEALTH_CHECK providers from the container (value + class)', async () => {
    @injectable()
    class Db {
      ping() {
        return true
      }
    }
    @injectable()
    class DbHealth implements HealthCheck {
      private readonly db = inject(Db)
      name = 'db'
      check() {
        return this.db.ping()
      }
    }
    const app = await createApp({
      controllers: [],
      providers: [
        {
          provide: HEALTH_CHECK,
          useValue: { name: 'disk', check: () => true },
        },
        { provide: HEALTH_CHECK, useClass: DbHealth },
      ],
      plugins: [health()],
    })
    const res = await app.handle(new Request('http://t/ready'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      checks: Array<{ name: string; status: string }>
    }
    expect(body.checks).toContainEqual({ name: 'disk', status: 'up' })
    expect(body.checks).toContainEqual({ name: 'db', status: 'up' }) // injected Db
  })

  test('merges explicit checks with DI-collected ones, and 503s on a failure', async () => {
    const app = await createApp({
      controllers: [],
      providers: [
        {
          provide: HEALTH_CHECK,
          useValue: { name: 'redis', check: () => false },
        },
      ],
      plugins: [health({ checks: [{ name: 'inline', check: () => true }] })],
    })
    const res = await app.handle(new Request('http://t/ready'))
    expect(res.status).toBe(503)
    const body = (await res.json()) as {
      checks: Array<{ name: string; status: string }>
    }
    expect(body.checks).toContainEqual({ name: 'inline', status: 'up' })
    expect(body.checks).toContainEqual({ name: 'redis', status: 'down' })
  })
})
