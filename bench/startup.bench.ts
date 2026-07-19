// Startup cost: how long `createApp()` takes to build an app, and what the
// filesystem auto-discovery scan adds over passing controllers explicitly.
//
// Both arms mount the SAME 12 controllers (bench/fixtures). The manual arm
// receives the already-imported classes, so it measures mount only; the
// auto arm additionally globs the directory and reads each file, so the
// difference is the discovery overhead. (The one-time module-import cost is
// paid once by both — statically here, or on first scan in a real app.)

import { createApp } from 'turnover'
import { controllers } from './fixtures'
import { formatDuration, type Section, time } from './harness'

const fixturesDir = `${import.meta.dir}/fixtures`

export async function run(options: { quick?: boolean } = {}): Promise<Section> {
  const rounds = options.quick ? 3 : 20
  const timing = { warmup: 2, rounds, batch: 1 }

  const manual = await time(() => createApp({ controllers }), timing)
  const auto = await time(() => createApp({ dir: fixturesDir }), timing)
  const overhead = auto.meanNs - manual.meanNs

  return {
    title: `Startup — createApp() with ${controllers.length} controllers`,
    rows: [
      {
        label: 'Manual (explicit controllers)',
        value: formatDuration(manual.meanNs),
        note: `p99 ${formatDuration(manual.p99Ns)}`,
      },
      {
        label: 'Auto-discovery (scan directory)',
        value: formatDuration(auto.meanNs),
        note: `p99 ${formatDuration(auto.p99Ns)}`,
      },
      {
        label: '→ filesystem discovery overhead',
        value: formatDuration(overhead),
        note: `${(overhead / manual.meanNs).toFixed(1)}× the manual cost`,
      },
    ],
  }
}

if (import.meta.main) {
  const { printSection } = await import('./harness')
  printSection(await run())
}
