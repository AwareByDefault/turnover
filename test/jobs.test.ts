import { describe, expect, test } from 'bun:test'
import { JobQueue } from '../src'

// A fixed clock keeps enqueue/backoff timing deterministic.
function queueAt(start: number, options = {}): [JobQueue, { t: number }] {
  const clock = { t: start }
  const queue = new JobQueue({ clock: () => clock.t, ...options })
  return [queue, clock]
}

describe('JobQueue', () => {
  test('runs a handler with its payload', async () => {
    const [queue] = queueAt(1000)
    const seen: unknown[] = []
    queue.on<{ to: string }>('email', (payload) => {
      seen.push(payload.to)
    })
    await queue.enqueue('email', { to: 'ada@acme.io' })
    const ran = await queue.process(1000)
    expect(ran).toBe(1)
    expect(seen).toEqual(['ada@acme.io'])
    expect(await queue.pending()).toBe(0)
  })

  test('does not run a delayed job before it is due', async () => {
    const [queue, clock] = queueAt(1000)
    let ran = 0
    queue.on('later', () => {
      ran += 1
    })
    await queue.enqueue('later', {}, { delay: 5000 }) // runAt = 6000

    clock.t = 5000
    expect(await queue.process()).toBe(0)
    expect(ran).toBe(0)

    clock.t = 6000
    expect(await queue.process()).toBe(1)
    expect(ran).toBe(1)
  })

  test('retries a failing handler with backoff, then succeeds', async () => {
    const [queue] = queueAt(1000)
    let attempts = 0
    queue.on('flaky', () => {
      attempts += 1
      if (attempts < 2) throw new Error('transient')
    })
    await queue.enqueue('flaky', {}) // runAt = 1000

    // Attempt 1 fails → rescheduled to 1000 + backoff(2) = 2000.
    await queue.process(1000)
    expect(attempts).toBe(1)
    expect(await queue.pending()).toBe(1)
    expect(await queue.process(1500)).toBe(0) // not due yet

    // Attempt 2 at 2000 succeeds.
    await queue.process(2000)
    expect(attempts).toBe(2)
    expect(await queue.pending()).toBe(0)
    expect(await queue.failed()).toHaveLength(0)
  })

  test('dead-letters a job once attempts are exhausted', async () => {
    const [queue] = queueAt(1000, { backoff: () => 0 })
    queue.on('doomed', () => {
      throw new Error('always fails')
    })
    await queue.enqueue('doomed', { x: 1 }, { maxAttempts: 2 })

    await queue.process(1000) // attempt 1 fails, reschedule (backoff 0)
    await queue.process(1000) // attempt 2 fails → dead letter
    const failed = await queue.failed()
    expect(failed).toHaveLength(1)
    expect(failed[0]?.attempts).toBe(2)
    expect(failed[0]?.lastError).toBe('always fails')
    expect(await queue.pending()).toBe(0)
  })

  test('a job with no registered handler is retried then dead-lettered', async () => {
    const [queue] = queueAt(1000, { backoff: () => 0 })
    await queue.enqueue('unknown', {}, { maxAttempts: 1 })
    await queue.process(1000)
    const failed = await queue.failed()
    expect(failed).toHaveLength(1)
    expect(failed[0]?.lastError).toContain('No handler')
  })

  test('processes due jobs in run-at order', async () => {
    const [queue] = queueAt(1000, { backoff: () => 0 })
    const order: string[] = []
    queue.on<string>('t', (payload) => {
      order.push(payload)
    })
    await queue.enqueue('t', 'second', { delay: 200 })
    await queue.enqueue('t', 'first', { delay: 100 })
    await queue.process(2000)
    expect(order).toEqual(['first', 'second'])
  })
})
