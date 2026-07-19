// Memory footprint. Heap numbers come from the live JSC heap size (`bun:jsc`)
// after a forced GC (`Bun.gc(true)`), so they reflect retained memory, not
// transient allocation. To get a stable per-app figure we allocate MANY apps
// and divide — a single app is below the measurement noise floor. Numbers are
// machine/runtime-dependent; read them as orders of magnitude. Best run in its
// own process (a clean heap).

import { type App, type Ctor, createApp } from 'turnover'
import { controllers } from './fixtures'
import { formatBytes, heapUsed, residentSize, type Section } from './harness'

async function heapPerApp(
  count: number,
  mount: readonly Ctor[],
): Promise<number> {
  const apps: App[] = []
  const before = heapUsed()
  for (let i = 0; i < count; i++) {
    apps.push(await createApp({ controllers: [...mount] }))
  }
  const perApp = (heapUsed() - before) / count
  // Reference the apps after measuring so GC can't collect them early.
  if (apps.length !== count) throw new Error('unreachable')
  return perApp
}

export async function run(options: { quick?: boolean } = {}): Promise<Section> {
  const apps = options.quick ? 25 : 250
  const requests = options.quick ? 2_000 : 25_000

  const perEmptyApp = await heapPerApp(apps, [])
  const perFullApp = await heapPerApp(apps, controllers)
  const perController = (perFullApp - perEmptyApp) / controllers.length

  const rss = residentSize()

  // Retained heap per request: warm, snapshot, handle many, snapshot again.
  // A near-zero delta means handling a request retains nothing (no leak).
  const app = await createApp({ controllers: controllers.slice(0, 1) })
  const req = new Request('http://bench/bench00/')
  for (let i = 0; i < 200; i++) await app.handle(req)
  const before = heapUsed()
  for (let i = 0; i < requests; i++) await app.handle(req)
  const perRequest = Math.max(0, (heapUsed() - before) / requests)
  if (Object.keys(app.routeTable()).length < 0) throw new Error('unreachable')

  return {
    title: 'Memory — retained heap (after forced GC)',
    rows: [
      {
        label: 'framework baseline (empty app)',
        value: formatBytes(perEmptyApp),
      },
      {
        label: `app + ${controllers.length} controllers`,
        value: formatBytes(perFullApp),
      },
      { label: '→ per controller', value: formatBytes(perController) },
      { label: 'RSS after boot', value: formatBytes(rss) },
      {
        label: 'retained per request',
        value: formatBytes(perRequest),
        note: `leak check over ${requests.toLocaleString()} requests (want ≈ 0)`,
      },
    ],
  }
}

if (import.meta.main) {
  const { printSection } = await import('./harness')
  printSection(await run({ quick: Bun.argv.includes('--quick') }))
}
