import { expect, test } from 'bun:test'

/** Read `proc.stdout` until it contains `marker`, returning everything so far. */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  marker: string,
  seed: string,
): Promise<string> {
  let out = seed
  while (!out.includes(marker)) {
    const { value, done } = await reader.read()
    if (done) break
    out += decoder.decode(value)
  }
  return out
}

test('listen() honors PORT from env, serves, and shuts down gracefully on SIGTERM', async () => {
  // A free port: bind on 0, read the assigned port, release it.
  const tmp = Bun.serve({ port: 0, fetch: () => new Response('ok') })
  const port = tmp.port
  tmp.stop(true)

  const proc = Bun.spawn({
    cmd: ['bun', 'run', `${import.meta.dir}/runtime/server.ts`],
    env: { ...process.env, PORT: String(port) },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  try {
    let out = await readUntil(reader, decoder, 'READY', '')
    // The env PORT was honored (the process bound exactly that port).
    expect(out).toContain(`READY port=${port}`)

    // It is serving on that port.
    const res = await fetch(`http://localhost:${port}/ping`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    // SIGTERM triggers a graceful stop (onStop runs) and a clean exit.
    proc.kill('SIGTERM')
    out = await readUntil(reader, decoder, 'STOPPED', out)
    expect(out).toContain('STOPPED')
    expect(await proc.exited).toBe(0)
  } finally {
    reader.releaseLock()
    proc.kill()
  }
})
