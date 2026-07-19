import { describe, expect, test } from 'bun:test'
import { createApp, health } from '../src'

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
})
