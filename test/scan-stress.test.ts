import { describe, expect, test } from 'bun:test'

// Stress-test the filesystem auto-discovery scan against a large, complex,
// generated fixture (300+ files, 200+ endpoints, deep DI, auth, validation,
// method AOP, events). The fixture is generated into a gitignored directory and
// is NOT committed — see test/scan-stress/generate.ts for why.
//
// The actual run is a standalone script executed in its OWN process
// (test/scan-stress/run.ts): `createApp({ dir })` mounts the *global*
// @controller registry, so running it inside the shared `bun test` process
// would also pick up controllers other test files registered. A clean process
// isolates the scan to this fixture's controllers.

describe('filesystem scan stress', () => {
  test('discovers and fully wires a 300+ file, 200+ endpoint tree', async () => {
    const proc = Bun.spawn({
      cmd: ['bun', 'run', `${import.meta.dir}/scan-stress/run.ts`],
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (code !== 0) throw new Error(`scan-stress run failed:\n${out}\n${err}`)
    expect(out).toContain('scan-stress OK')
  }, 60_000)
})
