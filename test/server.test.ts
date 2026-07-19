import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { type App, type Context, controller, createApp, get } from '../src'

@controller('/ping')
class PingController {
  @get('/')
  ping() {
    return { pong: true }
  }

  @get('/:id')
  echo(ctx: Context<{ id: string }>) {
    return { id: ctx.params.id }
  }
}

let server: ReturnType<App['listen']>
let base: string

beforeAll(async () => {
  const app = await createApp({ controllers: [PingController] })
  server = app.listen(0) // 0 => OS-assigned port
  base = server.url.href.replace(/\/$/, '')
})

afterAll(() => {
  server.stop(true)
})

describe('listen() lifecycle', () => {
  test('listen(0) binds an OS-assigned port', () => {
    expect(server.port).toBeGreaterThan(0)
  })

  test('serves real HTTP requests', async () => {
    const res = await fetch(`${base}/ping`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ pong: true })
  })

  test('serves path params over the wire', async () => {
    const res = await fetch(`${base}/ping/99`)
    expect(await res.json()).toEqual({ id: '99' })
  })

  test('unknown routes 404 over the wire', async () => {
    const res = await fetch(`${base}/missing`)
    expect(res.status).toBe(404)
  })
})

describe('handle() matches listen()', () => {
  test('the served response equals the in-memory one', async () => {
    const app = await createApp({ controllers: [PingController] })
    const served = await fetch(`${base}/ping/7`).then((r) => r.json())
    const inMemory = await app
      .handle(new Request('http://t/ping/7'))
      .then((r) => r.json())
    expect(inMemory).toEqual(served)
  })
})
