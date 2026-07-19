/** One Server-Sent Event. `data` is sent verbatim if a string, else JSON. */
export interface SseEvent {
  /** Payload — a string is sent as-is; anything else is JSON-serialized. */
  data: unknown
  /** Event name (the client's `addEventListener(name, …)`). */
  event?: string
  /** Event id (echoed as `Last-Event-ID` on reconnect). */
  id?: string
  /** Client reconnect delay in milliseconds. */
  retry?: number
}

/** Options for {@link sse}. */
export interface SseOptions {
  /** Emit a comment heartbeat every N ms to keep intermediaries from timing out. */
  keepAlive?: number
  /** Extra response headers. */
  headers?: HeadersInit
}

/** Serialize one event into the `text/event-stream` wire format. */
function formatEvent(event: SseEvent): string {
  let frame = ''
  if (event.event) frame += `event: ${event.event}\n`
  if (event.id) frame += `id: ${event.id}\n`
  if (event.retry !== undefined) frame += `retry: ${Math.floor(event.retry)}\n`
  const data =
    typeof event.data === 'string' ? event.data : JSON.stringify(event.data)
  // A multi-line payload is split into one `data:` line per line.
  for (const line of data.split('\n')) frame += `data: ${line}\n`
  return `${frame}\n`
}

/**
 * Build a streaming `text/event-stream` {@link Response} from an async source —
 * return it straight from a route handler. The source is an async iterable (or
 * a function returning one), so an async generator that `yield`s events is the
 * usual shape; drive a push-style stream with an {@link SseChannel}. Iteration
 * stops when the source completes or the client disconnects.
 *
 * ```ts
 * @get('/events')
 * events() {
 *   return sse(async function* () {
 *     yield { event: 'tick', data: { n: 1 } }
 *     yield { data: 'done' }
 *   })
 * }
 * ```
 */
export function sse(
  source: AsyncIterable<SseEvent> | (() => AsyncIterable<SseEvent>),
  options: SseOptions = {},
): Response {
  const iterable = typeof source === 'function' ? source() : source
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let heartbeat: ReturnType<typeof setInterval> | undefined
      if (options.keepAlive) {
        heartbeat = setInterval(() => {
          controller.enqueue(encoder.encode(': keep-alive\n\n'))
        }, options.keepAlive)
      }
      try {
        for await (const event of iterable) {
          controller.enqueue(encoder.encode(formatEvent(event)))
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat)
        controller.close()
      }
    },
  })

  const headers = new Headers(options.headers)
  headers.set('content-type', 'text/event-stream')
  headers.set('cache-control', 'no-cache')
  headers.set('connection', 'keep-alive')
  return new Response(stream, { headers })
}

/**
 * A push-driven async event source for {@link sse}. `push` events from anywhere
 * (an event bus, a subscription) and `close` when done; the stream drains any
 * queued events before ending.
 *
 * ```ts
 * const channel = new SseChannel()
 * bus.on('notice', (n) => channel.push({ event: 'notice', data: n }))
 * return sse(channel)
 * ```
 */
export class SseChannel implements AsyncIterable<SseEvent> {
  private readonly queue: SseEvent[] = []
  private readonly waiters: Array<(result: IteratorResult<SseEvent>) => void> =
    []
  private closed = false

  /** Enqueue an event (ignored once closed). */
  push(event: SseEvent): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value: event, done: false })
    else this.queue.push(event)
  }

  /** End the stream once queued events have drained. */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const waiter of this.waiters) {
      waiter({ value: undefined as never, done: true })
    }
    this.waiters.length = 0
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SseEvent> {
    while (true) {
      const queued = this.queue.shift()
      if (queued !== undefined) {
        yield queued
        continue
      }
      if (this.closed) return
      const result = await new Promise<IteratorResult<SseEvent>>((resolve) => {
        this.waiters.push(resolve)
      })
      if (result.done) return
      yield result.value
    }
  }
}
