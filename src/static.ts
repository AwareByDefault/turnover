import { join, resolve, sep } from 'node:path'
import type { Plugin, RequestHook } from './app'

/** Options for {@link serveStatic}. */
export interface StaticOptions {
  /** Directory whose files are served. */
  dir: string
  /** URL prefix to mount under (default `"/"`). Stripped before file lookup. */
  prefix?: string
  /** File served for a directory request (default `"index.html"`; `""` disables). */
  index?: string
  /** `Cache-Control` header applied to every served file. */
  cacheControl?: string
}

/** Ensure a leading slash and no trailing slash (except the bare root). */
function normalizePrefix(prefix: string): string {
  const withLead = prefix.startsWith('/') ? prefix : `/${prefix}`
  return withLead.length > 1 ? withLead.replace(/\/+$/, '') : withLead
}

/**
 * Plugin: serve files from a directory before routing. A `GET`/`HEAD` under
 * `prefix` maps to a file in `dir` (`Content-Type` inferred from the extension);
 * a directory request serves `index`. A missing file falls through to the
 * router (so it 404s like any other unmatched route), and a path that escapes
 * `dir` (via `..`) is refused with `403`. Registered as a pre-routing hook, so
 * it never shadows a matched controller route beyond its `prefix`.
 *
 * ```ts
 * const app = await createApp({ plugins: [serveStatic({ dir: './public' })] })
 * ```
 */
export function serveStatic(options: StaticOptions): Plugin {
  const prefix = normalizePrefix(options.prefix ?? '/')
  const index = options.index ?? 'index.html'
  const root = resolve(options.dir)
  const onRequest: RequestHook = async (req) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return
    const pathname = decodeURIComponent(new URL(req.url).pathname)
    if (
      prefix !== '/' &&
      pathname !== prefix &&
      !pathname.startsWith(`${prefix}/`)
    ) {
      return
    }
    let rel = (
      prefix === '/' ? pathname : pathname.slice(prefix.length)
    ).replace(/^\/+/, '')
    if (rel === '') rel = index
    if (rel === '') return // index disabled and a directory was requested
    // Refuse anything that resolves outside the root. The URL parser collapses
    // plain and `%2e`-encoded dot segments, but `..%2f` (literal `..` + encoded
    // slash) survives parsing and reopens to `../` after decoding — this catches
    // it.
    const full = resolve(join(root, rel))
    if (full !== root && !full.startsWith(root + sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    const file = Bun.file(full)
    if (!(await file.exists())) return // fall through to the router (404)
    const headers = new Headers()
    if (options.cacheControl) headers.set('cache-control', options.cacheControl)
    return new Response(file, { headers })
  }
  return { onRequest }
}
