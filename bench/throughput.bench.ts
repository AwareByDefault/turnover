// Per-request throughput, measured through `app.handle(Request)` — the in-memory
// path that runs the full pipeline (routing, guards, DI, validation, coercion)
// without a socket. This isolates the framework's per-request overhead from
// Bun.serve and the network. Numbers are ops/s of sequential handling.

import {
  type Context,
  controller,
  createApp,
  type Guard,
  get,
  inject,
  injectable,
  post,
  type StandardSchemaV1,
  use,
} from 'turnover'
import { type Section, time, timingRow } from './harness'

// A tiny inline Standard Schema — no validator dependency, just the interface.
const nameSchema: StandardSchemaV1<{ name: string }, { name: string }> = {
  '~standard': {
    version: 1,
    vendor: 'bench',
    validate: (value) => {
      const name = (value as { name?: unknown })?.name
      return typeof name === 'string'
        ? { value: { name } }
        : { issues: [{ message: 'name must be a string' }] }
    },
  },
}

const authGuard: Guard = (ctx) => {
  if (!ctx.req.headers.get('authorization')) {
    return new Response('unauthorized', { status: 401 })
  }
}

@injectable()
class Greeter {
  greet(name: string): string {
    return `Hi, ${name}`
  }
}

let counter = 0
const nextId = (): number => {
  counter += 1
  return counter
}

@injectable({ scope: 'request' })
class RequestId {
  readonly id = nextId()
}

@controller('/')
class Routes {
  private readonly greeter = inject(Greeter)
  private readonly requestId = inject(RequestId)

  @get('/static')
  static_() {
    return { ok: true }
  }

  @get('/items/:id')
  param(ctx: Context<{ id: string }>) {
    return { id: ctx.params.id }
  }

  @get('/search')
  query(ctx: Context) {
    return { q: ctx.query.get('q'), limit: ctx.query.get('limit') }
  }

  @post('/echo')
  async echo(ctx: Context) {
    return { body: await ctx.body() }
  }

  @post('/validated', { body: nameSchema })
  validated(ctx: Context) {
    return { name: (ctx.valid.body as { name: string }).name }
  }

  @get('/guarded')
  @use(authGuard)
  guarded() {
    return { ok: true }
  }

  @get('/greet/:name')
  greet(ctx: Context<{ name: string }>) {
    return { msg: this.greeter.greet(ctx.params.name) }
  }

  @get('/scoped')
  scoped() {
    return { id: this.requestId.id }
  }
}

export async function run(options: { quick?: boolean } = {}): Promise<Section> {
  const timing = options.quick
    ? { warmup: 20, rounds: 3, batch: 200 }
    : { warmup: 500, rounds: 30, batch: 2000 }

  const app = await createApp({ controllers: [Routes] })

  // Reusable requests for GET routes (handle() never consumes them).
  const getReq = (path: string, headers?: HeadersInit) =>
    new Request(`http://bench${path}`, { headers })
  const postReq = () =>
    new Request('http://bench/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name":"Ada"}',
    })
  const validatedReq = () =>
    new Request('http://bench/validated', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name":"Ada"}',
    })

  const staticReq = getReq('/static')
  const paramReq = getReq('/items/42')
  const searchReq = getReq('/search?q=hello&limit=10')
  const guardedReq = getReq('/guarded', { authorization: 'Bearer t' })
  const greetReq = getReq('/greet/World')
  const scopedReq = getReq('/scoped')
  const missingReq = getReq('/does-not-exist')

  const rows = [
    timingRow(
      'static route → JSON',
      await time(() => app.handle(staticReq), timing),
    ),
    timingRow('path param', await time(() => app.handle(paramReq), timing)),
    timingRow('query parsing', await time(() => app.handle(searchReq), timing)),
    timingRow('guard (pass)', await time(() => app.handle(guardedReq), timing)),
    timingRow(
      'injected singleton',
      await time(() => app.handle(greetReq), timing),
    ),
    timingRow(
      'request-scoped bean',
      await time(() => app.handle(scopedReq), timing),
    ),
    timingRow(
      '404 (routing only)',
      await time(() => app.handle(missingReq), timing),
    ),
    timingRow(
      'POST JSON body parse',
      await time(() => app.handle(postReq()), timing),
    ),
    timingRow(
      'POST + schema validation',
      await time(() => app.handle(validatedReq()), timing),
    ),
  ]

  return { title: 'Throughput — app.handle() (in-memory, no socket)', rows }
}

if (import.meta.main) {
  const { printSection } = await import('./harness')
  printSection(await run({ quick: Bun.argv.includes('--quick') }))
}
