// Standalone scan stress-run, spawned by test/scan-stress.test.ts in its OWN
// process. Isolation matters: `createApp({ dir })` mounts the *global*
// @controller registry, so in the shared `bun test` process it would also pick
// up controllers other test files registered. A clean process guarantees the
// scan mounts only this fixture's controllers.
//
// It also compares server start time two ways: auto-discovery (the filesystem
// scan) vs. manual registration (`createApp({ controllers })`). Both are timed
// COLD, so a fair comparison needs two fresh processes — this file re-invokes
// itself with `--time-manual` to measure the manual path with nothing imported.

import { rm } from 'node:fs/promises'
import { type Ctor, createApp } from '../../src'
import { generateScanFixture } from './generate'

const root = `${import.meta.dir}/../.scan-fixture`

// --- Child mode: time a COLD manual createApp in this fresh process. The
//     fixture already exists on disk (the parent generated it). ---
if (Bun.argv.includes('--time-manual')) {
  const start = Bun.nanoseconds()
  const { controllers } = (await import(`${root}/controllers.ts`)) as {
    controllers: Ctor[]
  }
  const app = await createApp({ controllers })
  const ms = (Bun.nanoseconds() - start) / 1e6
  const mounted = Object.values(app.routeTable()).reduce(
    (n, methods) => n + methods.length,
    0,
  )
  await app.stop()
  console.log(`manual-startup-ms: ${ms.toFixed(1)} mounted: ${mounted}`)
  process.exit(0)
}

// --- Main: generate, auto-discover (validated), then compare vs. manual. ---
const flag = (name: string): string | undefined => {
  const i = Bun.argv.indexOf(name)
  return i >= 0 ? Bun.argv[i + 1] : undefined
}
// Scale with `--features N` or `--lines N` (default 40 features ≈ 7.8k lines;
// `--lines 1000000` ≈ 5155 features). `--cleanup` removes the huge fixture.
const SHARED_LINES = 70
const LINES_PER_FEATURE = 193.95
const targetLines = flag('--lines')
const features = Math.max(
  40,
  targetLines
    ? Math.ceil((Number(targetLines) - SHARED_LINES) / LINES_PER_FEATURE)
    : Number(flag('--features') ?? 40),
)
const cleanup = Bun.argv.includes('--cleanup')

function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`)
}

const genStart = Bun.nanoseconds()
const meta = await generateScanFixture(root, { features })
const genMs = (Bun.nanoseconds() - genStart) / 1e6
check(meta.files >= 300, `expected >= 300 files, got ${meta.files}`)
check(meta.endpoints >= 200, `expected >= 200 endpoints, got ${meta.endpoints}`)
console.log(
  `generated ${meta.features.toLocaleString()} features · ` +
    `${meta.files.toLocaleString()} files · ` +
    `${meta.lines.toLocaleString()} lines in ${genMs.toFixed(0)}ms`,
)

// Auto-discovery (the scan) — cold in this fresh process.
const start = Bun.nanoseconds()
const app = await createApp({ dir: root })
const scanMs = (Bun.nanoseconds() - start) / 1e6

const routes = app.routeTable()
const mounted = Object.values(routes).reduce(
  (n, methods) => n + methods.length,
  0,
)
check(mounted >= 200, `expected >= 200 mounted endpoints, got ${mounted}`)
check(routes['/feature-00'] !== undefined, 'feature-00 not discovered')
check(routes['/feature-39'] !== undefined, 'feature-39 not discovered')

const authHeaders = { authorization: 'Bearer user-token' }
const adminAuth = { authorization: 'Bearer admin-token' }
const json = { 'content-type': 'application/json' }
const req = (path: string, init?: RequestInit) =>
  app.handle(new Request(`http://stress${path}`, init))

// Auth guard: 401 without a token, 200 with one.
check(
  (await req('/feature-00/')).status === 401,
  'auth: expected 401 without token',
)
check(
  (await req('/feature-00/', { headers: authHeaders })).status === 200,
  'auth: expected 200 with token',
)

// Per-feature guard short-circuits.
check(
  (
    await req('/feature-07/', {
      headers: { ...authHeaders, 'x-block': 'feature-07' },
    })
  ).status === 403,
  'per-feature guard did not block',
)

// Validation: 422 on a bad body, success on a good one.
check(
  (
    await req('/feature-00/', {
      method: 'POST',
      headers: { ...authHeaders, ...json },
      body: '{"name":123}',
    })
  ).status === 422,
  'validation: expected 422 for bad body',
)
check(
  (
    await req('/feature-00/', {
      method: 'POST',
      headers: { ...authHeaders, ...json },
      body: '{"name":"Widget","value":10}',
    })
  ).status === 200,
  'validation: expected 200 for good body',
)

// Role guard on mutations: user forbidden, admin allowed.
check(
  (await req('/feature-00/x', { method: 'DELETE', headers: authHeaders }))
    .status === 403,
  'role guard: user should be forbidden',
)
check(
  (await req('/feature-00/x', { method: 'DELETE', headers: adminAuth }))
    .status === 200,
  'role guard: admin should be allowed',
)

// Events + deep DI + method AOP.
await req('/feature-05/', {
  method: 'POST',
  headers: { ...authHeaders, ...json },
  body: '{"name":"A","value":1}',
})
const { AuditService } = await import(`${root}/shared/audit`)
const audit = app.container.resolve(AuditService) as { count: number }
check(audit.count > 0, 'events: the shared audit listener never fired')

const { Service39 } = await import(`${root}/feature-39/service`)
const service39 = app.container.resolve(Service39) as { depth(): number }
check(service39.depth() === 40, 'deep cross-feature DI chain did not resolve')

await app.stop()

// Manual registration — timed COLD in a separate process (this one already
// imported every module via the scan, so it can't measure a cold manual start).
const child = Bun.spawn({
  cmd: ['bun', 'run', `${import.meta.dir}/run.ts`, '--time-manual'],
  stdout: 'pipe',
  stderr: 'pipe',
})
const [childOut, childErr, childCode] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
])
if (childCode !== 0)
  throw new Error(`manual-startup timing failed:\n${childErr}`)
const manualMs = Number(childOut.match(/manual-startup-ms: ([\d.]+)/)?.[1])
const manualMounted = Number(childOut.match(/mounted: (\d+)/)?.[1])
check(
  Number.isFinite(manualMs),
  `could not read manual startup time:\n${childOut}`,
)
check(
  manualMounted === mounted,
  `manual mounted ${manualMounted} endpoints, scan mounted ${mounted}`,
)

if (cleanup) await rm(root, { recursive: true, force: true })

const overhead = scanMs - manualMs
console.log('')
console.log(
  `Server start — ${meta.files.toLocaleString()} files / ` +
    `${meta.lines.toLocaleString()} lines / ${mounted.toLocaleString()} endpoints:`,
)
console.log(`  auto-discovery (scan)   ${scanMs.toFixed(0).padStart(6)} ms`)
console.log(`  manual registration     ${manualMs.toFixed(0).padStart(6)} ms`)
console.log(
  `  → filesystem-scan cost  ${overhead.toFixed(0).padStart(6)} ms  ` +
    `(${((overhead / manualMs) * 100).toFixed(0)}% over manual)`,
)
console.log('')
console.log(
  `scan-stress OK — ${meta.files.toLocaleString()} files · ` +
    `${meta.lines.toLocaleString()} lines · ${mounted.toLocaleString()} endpoints`,
)
