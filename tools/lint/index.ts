/**
 * Runs every custom lint check in {@link CHECKS}. Each check is a standalone
 * script under `checks/` that scans the tree and exits non-zero on any
 * violation; this runner spawns them in parallel, prints their output, and
 * fails if any failed — annotating each failure with the rule it enforces.
 *
 * Usage: `bun tools/lint/index.ts [--fix]`. `--fix` is passed through to checks
 * that support an auto-fix (framework/numbering checks don't). Wired into
 * `bun run lint` (verify) and `bun run lint:fix`.
 */
import { join } from 'node:path'
import { CHECKS, REGISTRY } from './checks-list'

const ROOT = join(import.meta.dir, '..', '..')
const fix = process.argv.includes('--fix')

const results = await Promise.all(
  CHECKS.map(async (name) => {
    const proc = Bun.spawn(
      [
        'bun',
        join(import.meta.dir, 'checks', `${name}.ts`),
        ...(fix ? ['--fix'] : []),
      ],
      { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { name, ok: code === 0, output: `${stdout}${stderr}`.trim() }
  }),
)

for (const result of results) {
  process.stdout.write(
    `[lint:checks] ${result.ok ? 'ok  ' : 'FAIL'} ${result.name}\n`,
  )
  if (result.output) process.stdout.write(`${result.output}\n`)
}

const failed = results.filter((result) => !result.ok)
if (failed.length > 0) {
  process.stderr.write(`\n[lint:checks] ${failed.length} check(s) failed:\n`)
  for (const { name } of failed) {
    const enforcement = REGISTRY[name]
    const enforces =
      'exempt' in enforcement
        ? `exempt (${enforcement.exempt})`
        : `${enforcement.doc} ${enforcement.rules.join(', ')}`
    process.stderr.write(`  - ${name} — enforces ${enforces}\n`)
  }
  process.exit(1)
}
