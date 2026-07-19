import { describe, expect, test } from 'bun:test'
import {
  type Context,
  controller,
  createApp,
  derive,
  type Guard,
  get,
  getRequestStore,
  inject,
  injectable,
  UnauthorizedError,
  use,
} from '../src'

// Apps describe their per-request store by augmenting RequestStore. A required
// field also proves the framework's empty-store init survives augmentation.
declare module '../src/request' {
  interface RequestStore {
    requestId: string
    tenant?: string
    role?: string
  }
}

@controller('/d1')
@derive(() => ({ tenant: 'acme' }))
class ClassDeriveController {
  @get('/')
  route(ctx: Context) {
    return { tenant: ctx.store.tenant }
  }
}

@controller('/d2')
@derive(() => ({ tenant: 'class' }))
class OrderController {
  @get('/merge')
  @derive(() => ({ role: 'admin' }))
  merge(ctx: Context) {
    return { tenant: ctx.store.tenant, role: ctx.store.role }
  }

  @get('/override')
  @derive(() => ({ tenant: 'method' }))
  override(ctx: Context) {
    return { tenant: ctx.store.tenant }
  }
}

const tenantGuard: Guard = (ctx) => {
  if (ctx.store.tenant !== 'ok') return new Response('denied', { status: 403 })
}

@controller('/d3')
@derive(() => ({ tenant: 'ok' }))
@use(tenantGuard)
class AllowedController {
  @get('/')
  route() {
    return { ok: true }
  }
}

@controller('/d3-bad')
@derive(() => ({ tenant: 'nope' }))
@use(tenantGuard)
class DeniedController {
  @get('/')
  route() {
    return { ok: true }
  }
}

@injectable()
class StoreReader {
  tenant() {
    return getRequestStore()?.tenant
  }
}

@controller('/d4')
@derive(() => ({ tenant: 'from-singleton' }))
class SingletonController {
  private readonly reader = inject(StoreReader)
  @get('/')
  route() {
    return { tenant: this.reader.tenant() }
  }
}

@controller('/d5')
@derive((ctx) => {
  ctx.store.role = 'writer' // write directly instead of returning
})
class DirectWriteController {
  @get('/')
  route(ctx: Context) {
    return { role: ctx.store.role }
  }
}

@controller('/d6')
@derive(() => {
  throw new UnauthorizedError('no session')
})
class ThrowingDeriveController {
  @get('/')
  route() {
    return { ok: true }
  }
}

@controller('/d7')
@derive((ctx) => ({ requestId: ctx.req.headers.get('x-req') ?? 'none' }))
class IsolationController {
  @get('/')
  route(ctx: Context) {
    return { id: ctx.store.requestId }
  }
}

@controller('/d8')
class NoDeriveController {
  @get('/')
  route(ctx: Context) {
    return { store: ctx.store }
  }
}

@controller('/d9')
@derive(async () => {
  await Promise.resolve()
  return { tenant: 'async' }
})
class AsyncDeriveController {
  @get('/')
  route(ctx: Context) {
    return { tenant: ctx.store.tenant }
  }
}

const app = await createApp({
  controllers: [
    ClassDeriveController,
    OrderController,
    AllowedController,
    DeniedController,
    SingletonController,
    DirectWriteController,
    ThrowingDeriveController,
    IsolationController,
    NoDeriveController,
    AsyncDeriveController,
  ],
})
const GET = (path: string, init?: RequestInit) =>
  app.handle(new Request(`http://t${path}`, init))

describe('@derive populates ctx.store', () => {
  test('a class deriver is visible to the handler', async () => {
    expect(await (await GET('/d1')).json()).toEqual({ tenant: 'acme' })
  })

  test('class and method derivers merge', async () => {
    expect(await (await GET('/d2/merge')).json()).toEqual({
      tenant: 'class',
      role: 'admin',
    })
  })

  test('method derivers run after class derivers (override wins)', async () => {
    expect(await (await GET('/d2/override')).json()).toEqual({
      tenant: 'method',
    })
  })

  test('a deriver can write ctx.store directly', async () => {
    expect(await (await GET('/d5')).json()).toEqual({ role: 'writer' })
  })

  test('an async deriver is awaited', async () => {
    expect(await (await GET('/d9')).json()).toEqual({ tenant: 'async' })
  })

  test('no derivers leaves the store empty', async () => {
    expect(await (await GET('/d8')).json()).toEqual({ store: {} })
  })
})

describe('derivers run before guards', () => {
  test('a guard sees a value the deriver set (allowed)', async () => {
    expect((await GET('/d3')).status).toBe(200)
  })

  test('a guard rejects based on derived state (denied)', async () => {
    expect((await GET('/d3-bad')).status).toBe(403)
  })
})

describe('store access & lifecycle', () => {
  test('an injected singleton reads the store via getRequestStore()', async () => {
    expect(await (await GET('/d4')).json()).toEqual({
      tenant: 'from-singleton',
    })
  })

  test('a throwing deriver aborts the request via the error pipeline', async () => {
    const res = await GET('/d6')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { message: 'no session' } })
  })

  test('the store is per-request (no leakage)', async () => {
    expect(
      await (await GET('/d7', { headers: { 'x-req': '1' } })).json(),
    ).toEqual({
      id: '1',
    })
    expect(
      await (await GET('/d7', { headers: { 'x-req': '2' } })).json(),
    ).toEqual({
      id: '2',
    })
    // A later request with no header must not see a prior request's id.
    expect(await (await GET('/d7')).json()).toEqual({ id: 'none' })
  })
})
