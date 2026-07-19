import { describe, expect, test } from 'bun:test'
import {
  CACHE_STORE,
  cacheable,
  cacheEvict,
  createApp,
  injectable,
  MemoryCache,
  TRANSACTION_MANAGER,
  type TransactionManager,
  transactional,
} from '../src'

class RecordingTM implements TransactionManager {
  log: string[] = []
  async run<T>(fn: () => T | Promise<T>): Promise<T> {
    this.log.push('begin')
    try {
      const result = await fn()
      this.log.push('commit')
      return result
    } catch (err) {
      this.log.push('rollback')
      throw err
    }
  }
}

@injectable()
class OrderService {
  @transactional
  async place(id: string) {
    return `placed:${id}`
  }

  @transactional
  async fail(): Promise<never> {
    throw new Error('boom')
  }

  plain() {
    return 'plain'
  }
}

describe('@transactional', () => {
  test('runs the method inside the bound TransactionManager (commit)', async () => {
    const tm = new RecordingTM()
    const app = await createApp({
      controllers: [],
      providers: [{ provide: TRANSACTION_MANAGER, useValue: tm }],
    })
    const svc = app.container.resolve(OrderService)
    expect(await svc.place('1')).toBe('placed:1')
    expect(tm.log).toEqual(['begin', 'commit'])
  })

  test('rolls back when the method throws', async () => {
    const tm = new RecordingTM()
    const app = await createApp({
      controllers: [],
      providers: [{ provide: TRANSACTION_MANAGER, useValue: tm }],
    })
    const svc = app.container.resolve(OrderService)
    await expect(svc.fail()).rejects.toThrow('boom')
    expect(tm.log).toEqual(['begin', 'rollback'])
  })

  test('with no manager bound, runs the method directly', async () => {
    const app = await createApp({ controllers: [] })
    const svc = app.container.resolve(OrderService)
    expect(await svc.place('2')).toBe('placed:2')
  })

  test('non-transactional methods are untouched', async () => {
    const app = await createApp({ controllers: [] })
    expect(app.container.resolve(OrderService).plain()).toBe('plain')
  })
})

let calls = 0
@injectable()
class Numbers {
  @cacheable()
  square(n: number) {
    calls += 1
    return n * n
  }

  @cacheable({ ttl: 10_000 })
  async fetch(id: string) {
    calls += 1
    return `data:${id}`
  }

  @cacheable({ keyBy: (u: { id: string }) => u.id })
  byUser(u: { id: string; extra?: number }) {
    calls += 1
    return u.id
  }

  @cacheEvict
  clearAll() {
    return 'cleared'
  }
}

describe('@cacheable / @cacheEvict', () => {
  const freshApp = () =>
    createApp({
      controllers: [],
      providers: [{ provide: CACHE_STORE, useValue: new MemoryCache() }],
    })

  test('memoizes by arguments', async () => {
    calls = 0
    const svc = (await freshApp()).container.resolve(Numbers)
    // The store is async, so a @cacheable method returns a Promise.
    expect(await svc.square(4)).toBe(16)
    expect(await svc.square(4)).toBe(16)
    expect(calls).toBe(1) // second call served from cache
    expect(await svc.square(5)).toBe(25)
    expect(calls).toBe(2) // different arg → recomputed
  })

  test('caches async results once resolved', async () => {
    calls = 0
    const svc = (await freshApp()).container.resolve(Numbers)
    expect(await svc.fetch('a')).toBe('data:a')
    expect(await svc.fetch('a')).toBe('data:a')
    expect(calls).toBe(1)
  })

  test('keyBy controls the cache key', async () => {
    calls = 0
    const svc = (await freshApp()).container.resolve(Numbers)
    await svc.byUser({ id: 'x', extra: 1 })
    await svc.byUser({ id: 'x', extra: 2 }) // same id → same key → cache hit
    expect(calls).toBe(1)
  })

  test('@cacheEvict clears the cache', async () => {
    calls = 0
    const svc = (await freshApp()).container.resolve(Numbers)
    await svc.square(4) // calls = 1
    await svc.clearAll()
    await svc.square(4) // recompute → calls = 2
    expect(calls).toBe(2)
  })
})
