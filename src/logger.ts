import { InjectionToken, injectable, injectOptional } from './di'
import { getRequestId } from './request'

/** Log severity, low to high. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

/** A structured log record: level, message, time, request id, and any fields. */
export interface LogRecord {
  /** Severity of the record. */
  level: LogLevel
  /** Human-readable event message; keep it stable and put variable data in the free-form fields below. */
  msg: string
  /** ISO-8601 timestamp of when the record was emitted. */
  time: string
  /** Correlation id of the request that produced it, when inside one. */
  requestId?: string
  /** Arbitrary structured fields merged into the record. */
  [key: string]: unknown
}

/** Consumes each emitted record (already past the level filter); called synchronously, once per record. */
export type LogSink = (record: LogRecord) => void

/** Override where log records go (default: JSON to stdout, warn/error to stderr). */
export const LOG_SINK = new InjectionToken<LogSink>('LogSink')
/** Override the minimum level (default: `LOG_LEVEL` env, else `"info"`). */
export const LOG_LEVEL = new InjectionToken<LogLevel>('LogLevel')

const jsonSink: LogSink = (record) => {
  const line = JSON.stringify(record)
  if (record.level === 'warn' || record.level === 'error') {
    console.error(line)
  } else {
    console.log(line)
  }
}

function envLevel(): LogLevel {
  const raw = (Bun.env.LOG_LEVEL ?? '').toLowerCase()
  return raw in LEVELS ? (raw as LogLevel) : 'info'
}

/**
 * Structured, injectable logger. Quiet by default — only records at or above the
 * minimum level (`info` unless `LOG_LEVEL` says otherwise) are emitted — and,
 * when the {@link requestId} plugin is active, each record emitted inside a
 * request is stamped with its id, so logs correlate to requests with no per-call
 * plumbing.
 *
 * ```ts
 * class Orders {
 *   private log = inject(Logger)
 *   place() { this.log.info('order placed', { total: 42 }) }
 * }
 * ```
 *
 * Records are JSON to stdout (warnings/errors to stderr) by default; bind a
 * `LOG_SINK` provider to route them elsewhere (a file, a collector, a test spy).
 */
@injectable()
export class Logger {
  private readonly sink = injectOptional(LOG_SINK, jsonSink)
  private readonly min = LEVELS[injectOptional(LOG_LEVEL, envLevel())]

  private write(
    level: LogLevel,
    msg: string,
    fields?: Record<string, unknown>,
  ): void {
    if (LEVELS[level] < this.min) return
    const id = getRequestId()
    this.sink({
      level,
      msg,
      time: new Date().toISOString(),
      ...(id ? { requestId: id } : {}),
      ...fields,
    })
  }

  /**
   * Log at `debug` — the lowest level, dropped unless the minimum is `debug`.
   *
   * @param msg - Event message; becomes the record's `msg` field.
   * @param fields - Structured fields; merged last, so keys `level`/`msg`/`time`/`requestId` here override the built-ins.
   */
  debug(msg: string, fields?: Record<string, unknown>): void {
    this.write('debug', msg, fields)
  }
  /**
   * Log at `info` — the default minimum level; goes to stdout via the default sink.
   *
   * @param msg - Event message; becomes the record's `msg` field.
   * @param fields - Structured fields; merged last, so keys `level`/`msg`/`time`/`requestId` here override the built-ins.
   */
  info(msg: string, fields?: Record<string, unknown>): void {
    this.write('info', msg, fields)
  }
  /**
   * Log at `warn` — routed to stderr (not stdout) by the default sink.
   *
   * @param msg - Event message; becomes the record's `msg` field.
   * @param fields - Structured fields; merged last, so keys `level`/`msg`/`time`/`requestId` here override the built-ins.
   */
  warn(msg: string, fields?: Record<string, unknown>): void {
    this.write('warn', msg, fields)
  }
  /**
   * Log at `error` — the highest level; routed to stderr by the default sink.
   *
   * @param msg - Event message; becomes the record's `msg` field.
   * @param fields - Structured fields; merged last, so keys `level`/`msg`/`time`/`requestId` here override the built-ins. Pass a caught error under a field (e.g. `{ err }`) rather than as `msg`.
   */
  error(msg: string, fields?: Record<string, unknown>): void {
    this.write('error', msg, fields)
  }
}
