import { describe, expect, test } from 'bun:test'
import {
  controller,
  createApp,
  get,
  type PageOptions,
  pageParams,
  paginated,
} from '../src'

function params(qs: string, opts?: PageOptions) {
  return pageParams(new URLSearchParams(qs), opts)
}

describe('pageParams', () => {
  test('defaults when absent', () => {
    expect(params('')).toEqual({ page: 1, limit: 20, offset: 0 })
  })
  test('reads page and limit, computing offset', () => {
    expect(params('page=3&limit=10')).toEqual({
      page: 3,
      limit: 10,
      offset: 20,
    })
  })
  test('clamps limit to maxLimit and page to >= 1', () => {
    expect(params('page=0&limit=999', { maxLimit: 50 })).toEqual({
      page: 1,
      limit: 50,
      offset: 0,
    })
  })
  test('ignores non-numeric values', () => {
    expect(params('page=abc&limit=xyz')).toEqual({
      page: 1,
      limit: 20,
      offset: 0,
    })
  })
})

describe('paginated', () => {
  test('wraps data with totals and derived page count', () => {
    expect(paginated(['a', 'b'], 25, params('page=2&limit=10'))).toEqual({
      data: ['a', 'b'],
      page: 2,
      limit: 10,
      total: 25,
      totalPages: 3,
    })
  })

  test('slices a page through a controller', async () => {
    @controller('/items')
    class Items {
      @get('/')
      list(ctx: { query: URLSearchParams }) {
        const p = pageParams(ctx.query)
        const all = Array.from({ length: 25 }, (_, i) => i)
        return paginated(all.slice(p.offset, p.offset + p.limit), all.length, p)
      }
    }
    const app = await createApp({ controllers: [Items] })
    const res = await app.handle(new Request('http://t/items?page=2&limit=10'))
    const body = (await res.json()) as { data: number[]; totalPages: number }
    expect(body.totalPages).toBe(3)
    expect(body.data).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  })
})
