import { describe, expect, test } from 'bun:test'

// Smoke-test the benchmark suite: each bench must run end-to-end (in --quick
// mode) without error and emit its section. This guards the benchmarks against
// bit-rot as the framework evolves — it does not assert any performance numbers.
// Each runs in its own process, exactly as `bun run bench` invokes it.

const benches = [
  { file: 'startup', marker: 'Startup' },
  { file: 'throughput', marker: 'Throughput' },
  { file: 'injection', marker: 'Injection' },
  { file: 'memory', marker: 'Memory' },
  { file: 'bundle', marker: 'Bundle size' },
]

describe('benchmarks', () => {
  for (const { file, marker } of benches) {
    test(`${file}.bench.ts runs and reports`, async () => {
      const proc = Bun.spawn({
        cmd: [
          'bun',
          'run',
          `${import.meta.dir}/../bench/${file}.bench.ts`,
          '--quick',
        ],
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      if (code !== 0)
        throw new Error(`${file}.bench.ts exited ${code}:\n${err}`)
      expect(out).toContain(marker)
    }, 30_000)
  }
})
