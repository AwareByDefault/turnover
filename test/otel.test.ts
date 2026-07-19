import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import {
  type Context,
  controller,
  createApp,
  get,
  inject,
  injectable,
} from '../src'
import { noTrace, otel, traced } from '../src/otel'

// --- In-memory OpenTelemetry SDK, registered once for the suite ---
const exporter = new InMemorySpanExporter()
let provider: BasicTracerProvider

const contextManager = new AsyncLocalStorageContextManager()

beforeAll(() => {
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
  // SDK 2.x: set the globals via the API (BasicTracerProvider has no register()).
  contextManager.enable()
  context.setGlobalContextManager(contextManager)
  propagation.setGlobalPropagator(new W3CTraceContextPropagator())
  trace.setGlobalTracerProvider(provider)
})

afterAll(async () => {
  await provider.shutdown()
  contextManager.disable()
  context.disable()
  trace.disable()
  propagation.disable()
})

beforeEach(() => exporter.reset())

const parentOf = (span: ReadableSpan): string | undefined =>
  span.parentSpanContext?.spanId
const serverSpan = () =>
  exporter.getFinishedSpans().find((s) => s.kind === SpanKind.SERVER)

// --- Fixture: a service with a @traced method, and controllers ---
@injectable()
class Work {
  @traced()
  async run(id: string): Promise<{ id: string }> {
    return { id }
  }
}

@controller('/orders')
class Orders {
  private readonly work = inject(Work)
  @get('/:id')
  getOne(ctx: Context<{ id: string }>) {
    return this.work.run(ctx.params.id)
  }
}

@controller('/fail')
class Fail {
  @get('/')
  boom(): never {
    throw new Error('kaboom')
  }
}

@controller('/health')
class Health {
  @get('/')
  ok() {
    return { ok: true }
  }
}

// Class-level @traced with a per-method @noTrace opt-out.
@traced()
@injectable()
class Catalog {
  find(id: string): { id: string } {
    return { id }
  }
  @noTrace
  healthPing(): string {
    return 'ok'
  }
}

@controller('/catalog')
class CatalogController {
  private readonly catalog = inject(Catalog)
  @get('/:id')
  getOne(ctx: Context<{ id: string }>) {
    this.catalog.healthPing() // opted out — no span
    return { item: this.catalog.find(ctx.params.id) } // traced
  }
}

// Method-level @traced configured with static attributes + an enrich callback.
@injectable()
class Widget {
  @traced({
    attributes: { 'widget.kind': 'gizmo' },
    enrich: (span, jp) => span.setAttribute('widget.id', String(jp.args[0])),
  })
  build(id: string): { id: string } {
    return { id }
  }
}

@controller('/widget')
class WidgetController {
  private readonly widget = inject(Widget)
  @get('/:id')
  make(ctx: Context<{ id: string }>) {
    return this.widget.build(ctx.params.id)
  }
}

describe('otel() plugin — one-line enablement', () => {
  test('no plugin means no server span (the plugin is opt-in)', async () => {
    // Health has no @traced service, so without otel() nothing is traced.
    const app = await createApp({ controllers: [Health] })
    await app.handle(new Request('http://api/health/'))
    expect(exporter.getFinishedSpans().length).toBe(0)
  })

  test('creates a SERVER span named by the route pattern (low cardinality)', async () => {
    const app = await createApp({
      controllers: [Orders, Fail, Health],
      plugins: [otel()],
    })
    const res = await app.handle(new Request('http://api/orders/42?q=1'))
    expect(res.status).toBe(200)

    const span = serverSpan()
    expect(span).toBeDefined()
    expect(span?.name).toBe('GET /orders/:id') // pattern, not /orders/42
    expect(span?.attributes['http.request.method']).toBe('GET')
    expect(span?.attributes['http.route']).toBe('/orders/:id')
    expect(span?.attributes['url.path']).toBe('/orders/42')
    expect(span?.attributes['url.query']).toBe('q=1')
    expect(span?.attributes['http.response.status_code']).toBe(200)
    expect(span?.status.code).not.toBe(SpanStatusCode.ERROR)
  })
})

describe('otel() plugin — nesting and propagation', () => {
  test('@traced service spans nest under the server span', async () => {
    const app = await createApp({ controllers: [Orders], plugins: [otel()] })
    await app.handle(new Request('http://api/orders/42'))

    const server = serverSpan()
    const method = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'Work.run')
    expect(server).toBeDefined()
    expect(method).toBeDefined()
    // Same trace, method span is a child of the server span.
    expect(method?.spanContext().traceId).toBe(server?.spanContext().traceId)
    expect(parentOf(method as ReadableSpan)).toBe(server?.spanContext().spanId)
  })

  test('continues an incoming W3C traceparent', async () => {
    const app = await createApp({ controllers: [Orders], plugins: [otel()] })
    const traceId = '0af7651916cd43dd8448eb211c80319c'
    const spanId = 'b7ad6b7169203331'
    await app.handle(
      new Request('http://api/orders/42', {
        headers: { traceparent: `00-${traceId}-${spanId}-01` },
      }),
    )
    const server = serverSpan()
    expect(server?.spanContext().traceId).toBe(traceId)
    expect(parentOf(server as ReadableSpan)).toBe(spanId)
  })
})

describe('otel() plugin — errors and customization', () => {
  test('records the exception and marks the span an error on a 5xx', async () => {
    const app = await createApp({ controllers: [Fail], plugins: [otel()] })
    const res = await app.handle(new Request('http://api/fail/'))
    expect(res.status).toBe(500)

    const span = serverSpan()
    expect(span?.status.code).toBe(SpanStatusCode.ERROR)
    expect(span?.attributes['http.response.status_code']).toBe(500)
    expect(span?.events.some((e) => e.name === 'exception')).toBe(true)
  })

  test('ignore() skips tracing (e.g. health checks)', async () => {
    const app = await createApp({
      controllers: [Health],
      plugins: [otel({ ignore: (ctx) => ctx.route === '/health' })],
    })
    await app.handle(new Request('http://api/health/'))
    expect(exporter.getFinishedSpans().length).toBe(0)
  })

  test('enrich() adds custom attributes to the server span', async () => {
    const app = await createApp({
      controllers: [Health],
      plugins: [
        otel({ enrich: (span) => span.setAttribute('app.tier', 'gold') }),
      ],
    })
    await app.handle(new Request('http://api/health/'))
    expect(serverSpan()?.attributes['app.tier']).toBe('gold')
  })
})

describe('@traced() — class-level, opt-out, and config', () => {
  test('a class-level @traced traces every public method (nested)', async () => {
    const app = await createApp({
      controllers: [CatalogController],
      plugins: [otel()],
    })
    await app.handle(new Request('http://api/catalog/42'))

    const find = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'Catalog.find')
    expect(find).toBeDefined()
    expect(parentOf(find as ReadableSpan)).toBe(
      serverSpan()?.spanContext().spanId,
    )
  })

  test('@noTrace() opts a method out of a class-level @traced', async () => {
    const app = await createApp({
      controllers: [CatalogController],
      plugins: [otel()],
    })
    await app.handle(new Request('http://api/catalog/42'))

    const names = exporter.getFinishedSpans().map((s) => s.name)
    expect(names).toContain('Catalog.find') // traced
    expect(names).not.toContain('Catalog.healthPing') // opted out
  })

  test('attributes and enrich(span, args) configure the span', async () => {
    const app = await createApp({
      controllers: [WidgetController],
      plugins: [otel()],
    })
    await app.handle(new Request('http://api/widget/7'))

    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'Widget.build')
    expect(span?.attributes['widget.kind']).toBe('gizmo') // static
    expect(span?.attributes['widget.id']).toBe('7') // from the call args
  })
})
