/** Normalized pagination parameters read from a query string. */
export interface PageParams {
  /** 1-based page number. */
  page: number
  /** Items per page. */
  limit: number
  /** Zero-based offset (`(page - 1) * limit`), for slicing or SQL `OFFSET`. */
  offset: number
}

/** Options for {@link pageParams}. */
export interface PageOptions {
  /** Items per page when `limit` is absent. Default 20. */
  defaultLimit?: number
  /** Upper bound on `limit`, so a client can't request an unbounded page. Default 100. */
  maxLimit?: number
}

/**
 * Read `?page` (1-based) and `?limit` from a query string into normalized,
 * clamped {@link PageParams}. Invalid or missing values fall back to the
 * defaults; `limit` is clamped to `[1, maxLimit]` and `page` to `>= 1`.
 *
 * ```ts
 * @get('/') list(ctx) {
 *   const p = pageParams(ctx.query)
 *   const [rows, total] = repo.page(p.offset, p.limit)
 *   return paginated(rows, total, p)
 * }
 * ```
 */
export function pageParams(
  query: URLSearchParams,
  options: PageOptions = {},
): PageParams {
  const defaultLimit = options.defaultLimit ?? 20
  const maxLimit = options.maxLimit ?? 100
  const page = Math.max(1, Math.floor(Number(query.get('page')) || 1))
  const rawLimit = Math.floor(Number(query.get('limit')) || defaultLimit)
  const limit = Math.min(maxLimit, Math.max(1, rawLimit))
  return { page, limit, offset: (page - 1) * limit }
}

/** A page of results in a standard envelope. */
export interface Page<T> {
  data: T[]
  page: number
  limit: number
  total: number
  totalPages: number
}

/**
 * Wrap a page of `data` (and the overall `total`) in a standard {@link Page}
 * envelope with the page number, limit, total count, and derived page count.
 */
export function paginated<T>(
  data: T[],
  total: number,
  params: PageParams,
): Page<T> {
  return {
    data,
    page: params.page,
    limit: params.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.limit)),
  }
}
