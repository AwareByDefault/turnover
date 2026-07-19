import { describe, expect, test } from 'bun:test'
import {
  controller,
  createApp,
  get,
  MetricsRegistry,
  metrics,
  post,
} from '../src'

describe('MetricsRegistry', () => {
  test('renders a labelled counter', () => {
    const reg = new MetricsRegistry()
    const c = reg.counter('reqs_total', 'Requests.', ['method'])
    c.inc({ method: 'GET' })
    c.inc({ method: 'GET' })
    c.inc({ method: 'POST' }, 3)
    const out = c.render()
    expect(out).toContain('# TYPE reqs_total counter')
    expect(out).toContain('reqs_total{method="GET"} 2')
    expect(out).toContain('reqs_total{method="POST"} 3')
  })

  test('a counter rejects negative increments', () => {
    const c = new MetricsRegistry().counter('c', 'C.')
    expect(() => c.inc({}, -1)).toThrow()
  })

  test('renders a gauge that moves up and down', () => {
    const g = new MetricsRegistry().gauge('inflight', 'In flight.')
    g.inc()
    g.inc()
    g.dec()
    g.set({}, 5)
    expect(g.render()).toContain('inflight 5')
  })

  test('renders a histogram with cumulative buckets, sum, and count', () => {
    const h = new MetricsRegistry().histogram('lat', 'Latency.', [], [1, 5])
    h.observe({}, 0.5) // ≤1 and ≤5
    h.observe({}, 3) // ≤5
    h.observe({}, 10) // >5
    const out = h.render()
    expect(out).toContain('# TYPE lat histogram')
    expect(out).toContain('lat_bucket{le="1"} 1')
    expect(out).toContain('lat_bucket{le="5"} 2')
    expect(out).toContain('lat_bucket{le="+Inf"} 3')
    expect(out).toContain('lat_sum 13.5')
    expect(out).toContain('lat_count 3')
  })

  test('escapes label values', () => {
    const c = new MetricsRegistry().counter('c', 'C.', ['path'])
    c.inc({ path: 'a"b\\c' })
    expect(c.render()).toContain('c{path="a\\"b\\\\c"} 1')
  })

  test('metric creation is idempotent by name', () => {
    const reg = new MetricsRegistry()
    const a = reg.counter('same', 'Help.')
    const b = reg.counter('same', 'Help.')
    expect(a).toBe(b)
  })
})

@controller('/x')
class X {
  @get('/a')
  a() {
    return { ok: true }
  }
  @post('/b')
  b() {
    return { ok: true }
  }
}

describe('metrics()', () => {
  test('auto-instruments requests and serves the exposition format', async () => {
    const app = await createApp({ controllers: [X], plugins: [metrics()] })
    await app.handle(new Request('http://t/x/a'))
    await app.handle(new Request('http://t/x/a'))
    await app.handle(new Request('http://t/x/b', { method: 'POST' }))

    const res = await app.handle(new Request('http://t/metrics'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    const body = await res.text()

    expect(body).toContain(
      'http_requests_total{method="GET",route="/x/a",status="200"} 2',
    )
    expect(body).toContain(
      'http_requests_total{method="POST",route="/x/b",status="200"} 1',
    )
    expect(body).toContain('http_request_duration_seconds_bucket')
    expect(body).toContain('http_request_duration_seconds_count')
    // Every request completed, so the in-flight gauge is back to zero.
    expect(body).toContain('http_requests_in_flight 0')
  })

  test('does not count scrapes of its own endpoint', async () => {
    const app = await createApp({ controllers: [X], plugins: [metrics()] })
    await app.handle(new Request('http://t/x/a'))
    await app.handle(new Request('http://t/metrics'))
    const body = await (
      await app.handle(new Request('http://t/metrics'))
    ).text()
    expect(body).not.toContain('route="/metrics"')
  })

  test('records custom metrics into a shared registry', async () => {
    const registry = new MetricsRegistry()
    const widgets = registry.counter('widgets_total', 'Widgets made.')
    widgets.inc()
    widgets.inc()

    const app = await createApp({
      controllers: [X],
      plugins: [metrics({ registry })],
    })
    await app.handle(new Request('http://t/x/a'))
    const body = await (
      await app.handle(new Request('http://t/metrics'))
    ).text()

    expect(body).toContain('widgets_total 2')
    expect(body).toContain('http_requests_total{method="GET",route="/x/a"')
  })

  test('honours a custom endpoint', async () => {
    const app = await createApp({
      controllers: [X],
      plugins: [metrics({ endpoint: '/internal/metrics' })],
    })
    expect((await app.handle(new Request('http://t/metrics'))).status).toBe(404)
    const res = await app.handle(new Request('http://t/internal/metrics'))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('http_requests_in_flight')
  })
})
