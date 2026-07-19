import { describe, expect, test } from 'bun:test'
import {
  type Context,
  controller,
  createApp,
  derive,
  get,
  resolve,
  type StandardResult,
  type StandardSchemaV1,
  type TraceEvent,
} from '../src'

function schema<T>(
  validate: (v: unknown) => StandardResult<T>,
): StandardSchemaV1 {
  return { '~standard': { version: 1, vendor: 'test', validate } }
}
const idParams = schema<{ id: number }>((v) => {
  const id = Number((v as { id?: unknown }).id)
  return Number.isNaN(id)
    ? { issues: [{ message: 'bad id' }] }
    : { value: { id } }
})

const order: string[] = []

@controller('/r')
class ResolveController {
  @get('/:id', { params: idParams })
  @derive(() => {
    order.push('derive')
  })
  @resolve((ctx) => {
    order.push(`resolve:${(ctx.valid.params as { id: number }).id}`)
  })
  go(ctx: Context) {
    order.push('handler')
    return { id: (ctx.valid.params as { id: number }).id }
  }
}

describe('@resolve (post-validation)', () => {
  test('runs after validation (reads ctx.valid) and before the handler', async () => {
    order.length = 0
    const app = await createApp({ controllers: [ResolveController] })
    const res = await app.handle(new Request('http://t/r/42'))
    expect(await res.json()).toEqual({ id: 42 })
    // derive (pre-guards) → resolve (post-validation) → handler
    expect(order).toEqual(['derive', 'resolve:42', 'handler'])
  })
})

@controller('/a')
class AController {
  @get('/')
  ok() {
    return { ok: true }
  }
}

describe('onAfterResponse', () => {
  test('runs after the response (fire-and-forget)', async () => {
    const seen: number[] = []
    const app = await createApp({
      controllers: [AController],
      onAfterResponse: [(res) => void seen.push(res.status)],
    })
    await app.handle(new Request('http://t/a'))
    expect(seen).toEqual([200])
  })

  test('runs on 404s too', async () => {
    const seen: number[] = []
    const app = await createApp({
      controllers: [AController],
      onAfterResponse: [(res) => void seen.push(res.status)],
    })
    await app.handle(new Request('http://t/missing'))
    expect(seen).toEqual([404])
  })

  test('can be registered by a plugin', async () => {
    const seen: number[] = []
    const app = await createApp({
      controllers: [AController],
      plugins: [{ onAfterResponse: [(res) => void seen.push(res.status)] }],
    })
    await app.handle(new Request('http://t/a'))
    expect(seen).toEqual([200])
  })
})

describe('onTrace', () => {
  test('reports the request duration and response', async () => {
    const events: TraceEvent[] = []
    const app = await createApp({
      controllers: [AController],
      onTrace: [(e) => events.push(e)],
    })
    await app.handle(new Request('http://t/a'))
    expect(events).toHaveLength(1)
    expect(events[0]!.durationMs).toBeGreaterThanOrEqual(0)
    expect(events[0]!.response.status).toBe(200)
  })
})
