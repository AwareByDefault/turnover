import { describe, expect, test } from 'bun:test'
import {
  addAround,
  aspectProcessor,
  Container,
  classMeta,
  decoratorMeta,
  injectable,
  type MetaBag,
} from '../src'

// Proves a consumer can rebuild the OpenTelemetry plugin's mechanism — a
// class-level advice decorator with a per-method opt-out — using ONLY the
// framework's public API (no internal imports). This is exactly how the
// in-tree `@traced` / `@noTrace` are built.

const SKIP = Symbol('audit.skip')
const calls: string[] = []

const skipSet = (meta: MetaBag): Set<PropertyKey> => {
  const set = (meta[SKIP] as Set<PropertyKey> | undefined) ?? new Set()
  meta[SKIP] = set
  return set
}

/** Method decorator: opt a method out of a class-level `@audited()`. */
function skipAudit(
  _value: unknown,
  context: ClassMethodDecoratorContext,
): void {
  skipSet(decoratorMeta(context)).add(context.name)
}

/** Class decorator: record every public method call — except opted-out ones. */
function audited() {
  return (cls: unknown, context: ClassDecoratorContext): void => {
    const meta = decoratorMeta(context)
    const skip = skipSet(meta)
    const proto = (cls as { prototype: object }).prototype
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || skip.has(name)) continue
      const descriptor = Object.getOwnPropertyDescriptor(proto, name)
      if (descriptor && typeof descriptor.value === 'function') {
        addAround(meta, name, (jp) => {
          calls.push(name)
          return jp.proceed()
        })
      }
    }
  }
}

@audited()
@injectable()
class Reports {
  build(): string {
    return 'built'
  }
  send(): string {
    return 'sent'
  }
  @skipAudit
  secret(): string {
    return 'shh'
  }
}

describe('building plugins on the public AOP + metadata surface', () => {
  test('a class-level advice decorator + opt-out works from public API only', () => {
    // The aspect processor is what makes advice run; createApp registers it
    // automatically, or a consumer wires it onto a container directly.
    const container = new Container()
    container.addPostProcessor(aspectProcessor)
    const reports = container.resolve(Reports)

    expect(reports.build()).toBe('built')
    expect(reports.send()).toBe('sent')
    expect(reports.secret()).toBe('shh') // opted out — not advised

    expect(calls).toEqual(['build', 'send']) // secret excluded
  })

  test('classMeta reads the metadata a decorator wrote', () => {
    const meta = classMeta(Reports)
    expect(meta).toBeDefined()
    const skip = meta?.[SKIP] as Set<PropertyKey> | undefined
    expect(skip?.has('secret')).toBe(true)
  })
})
