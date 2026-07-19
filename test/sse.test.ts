import { describe, expect, test } from 'bun:test'
import { controller, createApp, get, SseChannel, sse } from '../src'

@controller('/ev')
class Ev {
  @get('/gen')
  gen() {
    return sse(async function* () {
      yield { event: 'tick', id: '1', data: { n: 1 } }
      yield { data: 'line1\nline2' }
    })
  }
}

describe('sse()', () => {
  test('streams generator events in the event-stream format', async () => {
    const app = await createApp({ controllers: [Ev] })
    const res = await app.handle(new Request('http://t/ev/gen'))
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    const body = await res.text()
    expect(body).toContain('event: tick\nid: 1\ndata: {"n":1}\n\n')
    // A multi-line payload becomes one data: line per line.
    expect(body).toContain('data: line1\ndata: line2\n\n')
  })

  test('serializes a string payload verbatim and includes retry', async () => {
    const res = sse(async function* () {
      yield { data: 'hello', retry: 3000 }
    })
    const body = await res.text()
    expect(body).toBe('retry: 3000\ndata: hello\n\n')
  })

  test('streams a channel and ends when it closes', async () => {
    const channel = new SseChannel()
    channel.push({ data: 'one' })
    channel.push({ event: 'bye', data: 'two' })
    channel.close()
    const body = await sse(channel).text()
    expect(body).toContain('data: one\n\n')
    expect(body).toContain('event: bye\ndata: two\n\n')
  })
})

describe('SseChannel', () => {
  test('drains queued events then closes', async () => {
    const channel = new SseChannel()
    channel.push({ data: 'a' })
    channel.push({ data: 'b' })
    channel.close()
    const got: unknown[] = []
    for await (const event of channel) got.push(event.data)
    expect(got).toEqual(['a', 'b'])
  })

  test('delivers events pushed while a consumer is waiting', async () => {
    const channel = new SseChannel()
    const got: unknown[] = []
    const consumed = (async () => {
      for await (const event of channel) got.push(event.data)
    })()
    channel.push({ data: 'x' })
    channel.push({ data: 'y' })
    channel.close()
    await consumed
    expect(got).toEqual(['x', 'y'])
  })

  test('ignores pushes after close', async () => {
    const channel = new SseChannel()
    channel.push({ data: 'a' })
    channel.close()
    channel.push({ data: 'ignored' })
    const got: unknown[] = []
    for await (const event of channel) got.push(event.data)
    expect(got).toEqual(['a'])
  })
})
