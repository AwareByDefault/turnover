import { describe, expect, test } from 'bun:test'
import {
  Container,
  controller,
  createApp,
  get,
  inject,
  LOG_LEVEL,
  LOG_SINK,
  Logger,
  type LogRecord,
  requestId,
} from '../src'

function capturing() {
  const records: LogRecord[] = []
  const container = new Container()
  container.register(LOG_SINK, { useValue: (r: LogRecord) => records.push(r) })
  return { records, container }
}

describe('Logger', () => {
  test('emits records at/above the level and suppresses below it', () => {
    const { records, container } = capturing()
    const log = container.resolve(Logger)
    log.debug('hidden') // below default 'info'
    log.info('shown', { a: 1 })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ level: 'info', msg: 'shown', a: 1 })
    expect(typeof records[0]!.time).toBe('string')
  })

  test('LOG_LEVEL lowers the threshold', () => {
    const { records, container } = capturing()
    container.register(LOG_LEVEL, { useValue: 'debug' })
    container.resolve(Logger).debug('now shown')
    expect(records).toHaveLength(1)
    expect(records[0]!.level).toBe('debug')
  })

  test('warn and error are emitted', () => {
    const { records, container } = capturing()
    const log = container.resolve(Logger)
    log.warn('w')
    log.error('e')
    expect(records.map((r) => r.level)).toEqual(['warn', 'error'])
  })

  test('stamps the current request id automatically', async () => {
    const records: LogRecord[] = []
    @controller('/log')
    class LogController {
      private readonly log = inject(Logger)
      @get('/')
      go() {
        this.log.info('handled')
        return { ok: true }
      }
    }
    const app = await createApp({
      controllers: [LogController],
      plugins: [requestId()],
      providers: [
        { provide: LOG_SINK, useValue: (r: LogRecord) => records.push(r) },
      ],
    })
    await app.handle(
      new Request('http://t/log', { headers: { 'x-request-id': 'req-9' } }),
    )
    expect(records[0]).toMatchObject({ msg: 'handled', requestId: 'req-9' })
  })
})
