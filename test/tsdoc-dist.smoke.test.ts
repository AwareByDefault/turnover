import { expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import packageJson from '../package.json'
import {
  analyzeDtsDir,
  entryDtsFiles,
} from '../tools/lint/checks/tsdoc-coverage'

/**
 * End-to-end guard: run the package's declaration build (`tsc -p
 * tsconfig.build.json`), then assert the emitted `.d.ts` — exactly what npm ships
 * and consumers install — carries complete TSDoc for every public symbol. This
 * proves the docs survive the build pipeline, complementing the source-level
 * `tsdoc-coverage` lint check (which reads the same emitted `.d.ts`).
 */
test('the published .d.ts output carries 100% TSDoc (survives the npm build)', async () => {
  const root = join(import.meta.dir, '..')
  const out = join(tmpdir(), 'turnover-tsdoc-smoke')
  rmSync(out, { recursive: true, force: true })

  const tsc = join(root, 'node_modules', '.bin', 'tsc')
  const proc = Bun.spawn(
    [
      tsc,
      '-p',
      'tsconfig.build.json',
      '--emitDeclarationOnly',
      '--outDir',
      out,
    ],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' },
  )
  const code = await proc.exited
  if (code !== 0) {
    console.error(await new Response(proc.stderr).text())
  }
  expect(code).toBe(0)

  const entries = entryDtsFiles(packageJson)
  expect(entries.length).toBeGreaterThan(0)
  // The barrel must actually be emitted — a smoke test guards against a build
  // that quietly produces nothing.
  expect(await Bun.file(join(out, 'index.d.ts')).exists()).toBe(true)

  const violations = await analyzeDtsDir(out, entries)
  rmSync(out, { recursive: true, force: true })
  if (violations.length > 0) {
    console.error(
      violations.map((v) => `${v.file}: ${v.symbol} — ${v.message}`).join('\n'),
    )
  }
  expect(violations).toHaveLength(0)
}, 60_000)
