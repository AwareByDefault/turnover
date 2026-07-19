import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { controller, createApp, get, serveStatic } from '../src'

@controller('/api')
class Api {
  @get('/ping')
  ping() {
    return { ok: true }
  }
}

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'turnover-static-'))
  writeFileSync(join(dir, 'hello.txt'), 'hello static')
  writeFileSync(join(dir, 'index.html'), '<h1>home</h1>')
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'sub', 'data.json'), '{"a":1}')
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('serveStatic()', () => {
  test('serves a file with an inferred content-type', async () => {
    const app = await createApp({
      controllers: [Api],
      plugins: [serveStatic({ dir, prefix: '/public' })],
    })
    const res = await app.handle(new Request('http://t/public/hello.txt'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(await res.text()).toBe('hello static')
  })

  test('serves the index file for a directory request', async () => {
    const app = await createApp({
      controllers: [Api],
      plugins: [serveStatic({ dir, prefix: '/public' })],
    })
    const res = await app.handle(new Request('http://t/public'))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('home')
  })

  test('serves a nested file with a json content-type', async () => {
    const app = await createApp({
      controllers: [Api],
      plugins: [serveStatic({ dir, prefix: '/public' })],
    })
    const res = await app.handle(new Request('http://t/public/sub/data.json'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ a: 1 })
  })

  test('applies a configured Cache-Control header', async () => {
    const app = await createApp({
      controllers: [Api],
      plugins: [
        serveStatic({ dir, prefix: '/public', cacheControl: 'max-age=3600' }),
      ],
    })
    const res = await app.handle(new Request('http://t/public/hello.txt'))
    expect(res.headers.get('cache-control')).toBe('max-age=3600')
  })

  test('falls through to the router for a missing file', async () => {
    const app = await createApp({
      controllers: [Api],
      plugins: [serveStatic({ dir, prefix: '/public' })],
    })
    const res = await app.handle(new Request('http://t/public/missing.txt'))
    expect(res.status).toBe(404)
  })

  test('does not shadow routes outside its prefix', async () => {
    const app = await createApp({
      controllers: [Api],
      plugins: [serveStatic({ dir, prefix: '/public' })],
    })
    const res = await app.handle(new Request('http://t/api/ping'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('refuses a path that escapes the root via `..` + encoded slash', async () => {
    const app = await createApp({
      controllers: [Api],
      plugins: [serveStatic({ dir, prefix: '/public' })],
    })
    // `..%2f` survives URL parsing (the segment isn't a bare `..`, so no
    // dot-segment collapse); decodeURIComponent then reopens it to `../`, which
    // the root guard must catch.
    const res = await app.handle(
      new Request('http://t/public/..%2f..%2fetc/passwd'),
    )
    expect(res.status).toBe(403)
  })

  test('neutralizes plain encoded `..` via URL normalization (404, no escape)', async () => {
    const app = await createApp({
      controllers: [Api],
      plugins: [serveStatic({ dir, prefix: '/public' })],
    })
    // `%2e%2e` is decoded and dot-collapsed by the URL parser to `/etc/passwd`,
    // which falls outside the prefix — served by nobody, so a plain 404.
    const res = await app.handle(
      new Request('http://t/public/%2e%2e/%2e%2e/etc/passwd'),
    )
    expect(res.status).toBe(404)
  })
})
