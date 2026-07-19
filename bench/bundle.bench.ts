// Build/bundle footprint. Bundles the public entry (`src/index.ts`) with
// Bun.build and reports the raw, minified, and gzipped sizes — what a consumer
// actually pays after tree-shaking — plus the size of the published `dist/`.

import { formatBytes, type Section } from './harness'

const entry = `${import.meta.dir}/../src/index.ts`
const distDir = `${import.meta.dir}/../dist`

async function build(minify: boolean): Promise<Uint8Array<ArrayBuffer>> {
  const result = await Bun.build({
    entrypoints: [entry],
    minify,
    target: 'bun',
  })
  if (!result.success) {
    throw new AggregateError(result.logs, 'bundle failed')
  }
  const [output] = result.outputs
  if (!output) throw new Error('bundle produced no output')
  return new Uint8Array(await output.arrayBuffer())
}

async function distTotal(): Promise<number | null> {
  // `dist/` only exists after `bun run build` — treat a missing directory
  // (Bun.Glob throws ENOENT) as "not built".
  try {
    const glob = new Bun.Glob('*.js')
    let bytes = 0
    let found = false
    for await (const rel of glob.scan({ cwd: distDir })) {
      found = true
      bytes += Bun.file(`${distDir}/${rel}`).size
    }
    return found ? bytes : null
  } catch {
    return null
  }
}

export async function run(options: { quick?: boolean } = {}): Promise<Section> {
  const minified = await build(true)
  const gzipped = Bun.gzipSync(minified).length
  const raw = options.quick ? null : (await build(false)).length
  const dist = await distTotal()

  const rows = [
    { label: 'bundled + minified', value: formatBytes(minified.length) },
    {
      label: 'minified + gzipped',
      value: formatBytes(gzipped),
      note: 'what ships over the wire',
    },
  ]
  if (raw !== null) {
    rows.unshift({ label: 'bundled (unminified)', value: formatBytes(raw) })
  }
  rows.push({
    label: 'published dist/*.js',
    value: dist === null ? 'not built' : formatBytes(dist),
    note: dist === null ? 'run: bun run build' : 'unminified, per-module',
  })

  return { title: 'Bundle size — tree-shaken public entry', rows }
}

if (import.meta.main) {
  const { printSection } = await import('./harness')
  printSection(await run({ quick: Bun.argv.includes('--quick') }))
}
