import { describe, expect, test } from 'bun:test'
import { controller, createApp, get, type WebSocketRoute } from '../src'

@controller('/http')
class Http {
  @get('/ping')
  ping() {
    return { ok: true }
  }
}

describe('websocket', () => {
  test('upgrades, greets on open, and echoes messages', async () => {
    const route: WebSocketRoute<{ user: string }> = {
      path: '/ws',
      upgrade: (req) => ({
        user: new URL(req.url).searchParams.get('user') ?? 'anon',
      }),
      open: (ws) => {
        ws.send(`welcome ${ws.data.user}`)
      },
      message: (ws, message) => {
        ws.send(`echo:${message}`)
      },
    }
    const app = await createApp({ controllers: [Http], websocket: route })
    const server = app.listen(0, { signals: false })
    try {
      const messages = await new Promise<string[]>((resolve, reject) => {
        const got: string[] = []
        const ws = new WebSocket(`ws://localhost:${server.port}/ws?user=ada`)
        ws.addEventListener('open', () => ws.send('hi'))
        ws.addEventListener('message', (event) => {
          got.push(String(event.data))
          if (got.length === 2) {
            ws.close()
            resolve(got)
          }
        })
        ws.addEventListener('error', () => reject(new Error('socket error')))
        setTimeout(() => reject(new Error('timed out')), 3000)
      })
      expect(messages).toEqual(['welcome ada', 'echo:hi'])
    } finally {
      await app.stop(true)
    }
  })

  test('still serves HTTP routes alongside the socket', async () => {
    const app = await createApp({
      controllers: [Http],
      websocket: { path: '/ws', message: () => {} },
    })
    const server = app.listen(0, { signals: false })
    try {
      const res = await fetch(`http://localhost:${server.port}/http/ping`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
    } finally {
      await app.stop(true)
    }
  })

  test('does not upgrade a request to a different path', async () => {
    // A non-upgrade request to the socket path falls through to HTTP routing.
    const app = await createApp({
      controllers: [Http],
      websocket: { path: '/ws', message: () => {} },
    })
    const server = app.listen(0, { signals: false })
    try {
      const res = await fetch(`http://localhost:${server.port}/ws`)
      // No HTTP route at /ws, so the router 404s (the socket only upgrades).
      expect(res.status).toBe(404)
    } finally {
      await app.stop(true)
    }
  })
})
