import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BunPlugin } from 'bun'
import { turnoverPlugin } from '../src/bundler'

// Does a Turnover server survive `bun build` bundling? This test actually
// bundles two servers, runs each from a CLEAN directory (no source .ts to
// scan), and hits their endpoints — proving that manual registration works
// end-to-end through a bundle, and documenting that auto-discovery does not
// (its controllers are tree-shaken out and there is no source tree to scan).

const fixtures = join(import.meta.dir, 'bundle-smoke')
const tempDirs: string[] = []

interface Served {
  proc: Bun.Subprocess
  port: number
  routes: Record<string, string[]>
}

async function bundleAndServe(
  entry: string,
  plugins: BunPlugin[] = [],
): Promise<Served> {
  // Bundle into a fresh temp dir so the running server's directory contains
  // only the .js bundle — exactly like a deployed build.
  const outdir = await mkdtemp(join(tmpdir(), 'turnover-bundle-'))
  tempDirs.push(outdir)
  const built = await Bun.build({
    entrypoints: [join(fixtures, entry)],
    outdir,
    target: 'bun',
    plugins,
  })
  if (!built.success) {
    throw new AggregateError(built.logs, `bundling ${entry} failed`)
  }
  const outfile = built.outputs[0]!.path

  const proc = Bun.spawn({
    cmd: ['bun', outfile],
    env: { ...process.env, PORT: '0' },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Wait for the server to print its READY line.
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let out = ''
  while (!out.includes('READY')) {
    const { value, done } = await reader.read()
    if (done) break
    out += decoder.decode(value)
  }
  reader.releaseLock()

  const match = out.match(/READY port=(\d+) routes=(\{.*\})/)
  if (!match) {
    proc.kill()
    const err = await new Response(proc.stderr).text()
    throw new Error(`bundled server never started:\n${out}\n${err}`)
  }
  return { proc, port: Number(match[1]!), routes: JSON.parse(match[2]!) }
}

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true })
})

describe('bun build bundling', () => {
  test('a manually-registered server survives bundling (routing, DI, params)', async () => {
    const { proc, port, routes } = await bundleAndServe('manual.entry.ts')
    try {
      expect(routes['/hello/:name']).toEqual(['GET'])
      const res = await fetch(`http://localhost:${port}/hello/world`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ message: 'Hello, world!' })
    } finally {
      proc.kill()
    }
  }, 30_000)

  test('auto-discovery does NOT survive bundling — controllers are tree-shaken', async () => {
    const { proc, port, routes } = await bundleAndServe('auto.entry.ts')
    try {
      // The controller is not statically reachable, so it is bundled away, and
      // the runtime scan finds no source files → an empty server.
      expect(routes).toEqual({})
      const res = await fetch(`http://localhost:${port}/hello/world`)
      expect(res.status).toBe(404) // → register controllers explicitly to bundle
    } finally {
      proc.kill()
    }
  }, 30_000)

  test('turnoverPlugin() makes auto-discovery survive bundling (no source change)', async () => {
    // Same auto-discovery entry (createApp() with no args) — the plugin scans
    // for @controller files at build time and bundles them in.
    const { proc, port, routes } = await bundleAndServe('auto.entry.ts', [
      turnoverPlugin(),
    ])
    try {
      expect(routes['/hello/:name']).toEqual(['GET'])
      const res = await fetch(`http://localhost:${port}/hello/world`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ message: 'Hello, world!' })
    } finally {
      proc.kill()
    }
  }, 30_000)
})
