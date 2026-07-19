// Run the whole benchmark suite: `bun run bench`.
//
// Each benchmark runs in its OWN process. That keeps them honest — a clean heap
// for the memory numbers, and an isolated `@controller` discovery registry so
// the startup benchmark's auto-discovery arm sees only its own fixtures. Pass
// `--quick` to shrink iteration counts (used by the smoke test).

const benches = ['startup', 'throughput', 'injection', 'memory', 'bundle']
const quick = Bun.argv.includes('--quick')

console.log('turnover — performance benchmarks')
console.log(`Bun ${Bun.version} · ${process.platform}/${process.arch}`)
console.log(
  'Numbers are machine-dependent; read relative costs, not absolutes.',
)

for (const name of benches) {
  const proc = Bun.spawn({
    cmd: [
      'bun',
      'run',
      `${import.meta.dir}/${name}.bench.ts`,
      ...(quick ? ['--quick'] : []),
    ],
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await proc.exited
  if (code !== 0) {
    console.error(`\n${name}.bench.ts exited with code ${code}`)
    process.exit(code)
  }
}

console.log('\nDone.')
