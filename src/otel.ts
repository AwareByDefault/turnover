// OpenTelemetry integration, exposed as the `turnover/otel` subpath so the core
// package stays dependency-free — only apps that opt in pull in
// `@opentelemetry/api`. It depends solely on the stable OTel *API*; the app
// registers an SDK. If none is registered, every call here is a no-op (zero
// overhead), which is the standard OTel-instrumentation contract.

import {
  type Attributes,
  context,
  propagation,
  type Span,
  SpanKind,
  SpanStatusCode,
  type TextMapGetter,
  type Tracer,
  trace,
} from '@opentelemetry/api'
import { type AroundAdvice, addAround, type JoinPoint } from './aop'
import type { Plugin } from './app'
import type { ErrorHandler, Context as HttpContext, Interceptor } from './http'
import { type Ctor, ctxMeta } from './metadata'

const NAME = 'turnover'

/** Reads a W3C `traceparent` (and friends) off an incoming `Headers`. */
const headerGetter: TextMapGetter<Headers> = {
  keys: (carrier) => [...carrier.keys()],
  get: (carrier, key) => carrier.get(key) ?? undefined,
}

/** Options for the {@link otel} plugin. Convention-first: everything defaults. */
export interface OtelOptions {
  /** Tracer name (default `"turnover"`) passed to `trace.getTracer`. */
  tracerName?: string
  /** Tracer version passed to `trace.getTracer`. */
  tracerVersion?: string
  /** Return `true` to skip tracing a request (e.g. health checks). */
  ignore?: (ctx: HttpContext) => boolean
  /** Add extra attributes to the server span (called after the defaults). */
  enrich?: (span: Span, ctx: HttpContext) => void
  /** Request header names to record as `http.request.header.<name>` attributes. */
  captureRequestHeaders?: string[]
}

/**
 * OpenTelemetry plugin — one line enables app-wide HTTP server tracing:
 *
 * ```ts
 * import { otel } from "turnover/otel";
 * const app = await createApp({ plugins: [otel()] });
 * ```
 *
 * With no options it creates a `SERVER` span per request named
 * `"<METHOD> <route>"` (low-cardinality, using the matched route pattern) with
 * HTTP semantic-convention attributes, continues an incoming W3C `traceparent`,
 * and records exceptions and 5xx as errors. The span is the **active** context
 * for the request, so `@traced` service methods — and any OTel-instrumented
 * client called from the handler — nest under it automatically.
 *
 * Override or extend via options (`ignore`, `enrich`, …) and per-method
 * `@traced()`. Requires an OpenTelemetry SDK registered by the app; without one
 * every call is a no-op.
 *
 * @param options - Tracing overrides; every field defaults.
 * @returns A plugin that adds per-request server-span tracing.
 */
export function otel(options: OtelOptions = {}): Plugin {
  const tracer: Tracer = trace.getTracer(
    options.tracerName ?? NAME,
    options.tracerVersion,
  )

  const wrap: Interceptor = async (ctx, next) => {
    if (options.ignore?.(ctx)) return next()

    const url = new URL(ctx.req.url)
    const method = ctx.req.method
    const parent = propagation.extract(
      context.active(),
      ctx.req.headers,
      headerGetter,
    )

    const span = tracer.startSpan(
      `${method} ${ctx.route || url.pathname}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          'http.request.method': method,
          'url.path': url.pathname,
          'url.query': url.search.slice(1) || undefined,
          'url.scheme': url.protocol.replace(/:$/, ''),
          'server.address': url.hostname,
          'http.route': ctx.route || undefined,
          'user_agent.original': ctx.req.headers.get('user-agent') ?? undefined,
        },
      },
      parent,
    )
    for (const header of options.captureRequestHeaders ?? []) {
      const value = ctx.req.headers.get(header)
      if (value !== null) {
        span.setAttribute(`http.request.header.${header.toLowerCase()}`, value)
      }
    }
    options.enrich?.(span, ctx)

    const spanContext = trace.setSpan(parent, span)
    try {
      const res = await context.with(spanContext, next)
      span.setAttribute('http.response.status_code', res.status)
      if (res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR })
      return res
    } catch (err) {
      // settle() normally converts throws to Responses; be defensive anyway.
      span.recordException(err as Error)
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw err
    } finally {
      span.end()
    }
  }

  // Record the thrown error on the active (server) span, then defer to the
  // app's own error rendering by returning nothing.
  const onError: ErrorHandler = (err) => {
    const span = trace.getActiveSpan()
    if (span) {
      span.recordException(err as Error)
      span.setStatus({ code: SpanStatusCode.ERROR })
    }
    return undefined
  }

  return { wrap, onError }
}

/** Options for {@link traced} — configure how each span is created. */
export interface TracedOptions {
  /**
   * Span name for a method-level `@traced` (default `"<Class>.<method>"`). A
   * class-level `@traced` ignores this and always names each span per method.
   */
  name?: string
  /** Tracer name (default `"turnover"`). */
  tracerName?: string
  /** Span kind (default `INTERNAL`). */
  kind?: SpanKind
  /** Static attributes set on every span this decorator creates. */
  attributes?: Attributes
  /** Enrich each span before the method runs — e.g. add attributes from args. */
  enrich?: (span: Span, joinPoint: JoinPoint) => void
}

// Metadata keys, shared with the class bag: which methods opt out of tracing,
// and which are already individually traced (so a class-level @traced skips them).
const NO_TRACE = Symbol('turnover.otel.noTrace')
const TRACED = Symbol('turnover.otel.traced')

/** Around-advice that opens a child span (nested under the active span). */
function traceAdvice(options: TracedOptions): AroundAdvice {
  const tracer = trace.getTracer(options.tracerName ?? NAME)
  return (jp) => {
    const target = jp.target as { constructor: { name: string } }
    const name = options.name ?? `${target.constructor.name}.${jp.method}`
    return tracer.startActiveSpan(
      name,
      {
        kind: options.kind ?? SpanKind.INTERNAL,
        attributes: options.attributes,
      },
      (span) => {
        options.enrich?.(span, jp)
        const fail = (err: unknown): never => {
          span.recordException(err as Error)
          span.setStatus({ code: SpanStatusCode.ERROR })
          span.end()
          throw err
        }
        try {
          const result = jp.proceed()
          if (result instanceof Promise) {
            return result.then((value) => {
              span.end()
              return value
            }, fail)
          }
          span.end()
          return result
        } catch (err) {
          return fail(err)
        }
      },
    )
  }
}

/** Own public (prototype) method names of a class — not the constructor, not getters. */
function methodNames(cls: Ctor): string[] {
  const names: string[] = []
  for (const name of Object.getOwnPropertyNames(cls.prototype)) {
    if (name === 'constructor') continue
    const descriptor = Object.getOwnPropertyDescriptor(cls.prototype, name)
    if (descriptor && typeof descriptor.value === 'function') names.push(name)
  }
  return names
}

/**
 * Trace method calls as child spans, nested under the active server span.
 *
 * On a **method**, wrap just that method:
 *
 * ```ts
 * class Orders {
 *   @traced() async place(order: Order) {}          // span "Orders.place"
 * }
 * ```
 *
 * On a **class**, wrap every public method — convention over configuration —
 * with per-method opt-out via {@link noTrace}:
 *
 * ```ts
 * @traced()
 * @injectable()
 * class Orders {
 *   place(order: Order) {}                           // traced
 *   @noTrace private hash(order: Order) {}            // not traced
 * }
 * ```
 *
 * Configure the spans with `kind`, static `attributes`, or an `enrich` callback
 * (which can read the call's arguments). Needs `createApp` (which auto-registers
 * the aspect processor) and the class to be resolved through the container.
 *
 * @param options - Span configuration (name, kind, attributes, enrich, …).
 * @returns A class/method decorator that traces the target as child spans.
 */
export function traced(options: TracedOptions = {}) {
  const methodAdvice = traceAdvice(options)
  // A class-level @traced names each span "<Class>.<method>", ignoring `name`.
  const classAdvice =
    options.name === undefined
      ? methodAdvice
      : traceAdvice({ ...options, name: undefined })

  return (
    value: unknown,
    decoratorContext: ClassDecoratorContext | ClassMethodDecoratorContext,
  ): void => {
    const meta = ctxMeta(decoratorContext)
    if (decoratorContext.kind === 'method') {
      addAround(meta, decoratorContext.name, methodAdvice)
      const traced = (meta[TRACED] as Set<PropertyKey> | undefined) ?? new Set()
      traced.add(decoratorContext.name)
      meta[TRACED] = traced
      return
    }
    // Class decorator: trace every public method not opted out or already traced.
    const skip = new Set<PropertyKey>([
      ...((meta[NO_TRACE] as Set<PropertyKey> | undefined) ?? []),
      ...((meta[TRACED] as Set<PropertyKey> | undefined) ?? []),
    ])
    for (const method of methodNames(value as Ctor)) {
      if (!skip.has(method)) addAround(meta, method, classAdvice)
    }
  }
}

/**
 * Method decorator: exclude a method from a class-level `@traced()` — the
 * "private" opt-out that keeps a method off an otherwise fully-traced class.
 *
 * @param _value - The decorated method (unused; metadata is keyed by name).
 * @param decoratorContext - The standard method-decorator context; its `name` marks the method.
 */
export function noTrace(
  _value: unknown,
  decoratorContext: ClassMethodDecoratorContext,
): void {
  const meta = ctxMeta(decoratorContext)
  const set = (meta[NO_TRACE] as Set<PropertyKey> | undefined) ?? new Set()
  set.add(decoratorContext.name)
  meta[NO_TRACE] = set
}
