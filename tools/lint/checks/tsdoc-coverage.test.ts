import { describe, expect, test } from 'bun:test'
import {
  analyzeDtsText,
  entryDtsFiles,
  isVoidishReturn,
  paramName,
  parseJsDoc,
  parseSignature,
  reexportTargets,
  splitTopLevel,
} from './tsdoc-coverage'

/** Analyze a `.d.ts` snippet and return `symbol: message` strings. */
const gaps = (dts: string): string[] =>
  analyzeDtsText('m.d.ts', dts).map((v) => `${v.symbol}: ${v.message}`)

describe('pure helpers', () => {
  test('isVoidishReturn', () => {
    expect(isVoidishReturn('void')).toBe(true)
    expect(isVoidishReturn('Promise<void>')).toBe(true)
    expect(isVoidishReturn(' never ')).toBe(true)
    expect(isVoidishReturn('string')).toBe(false)
    expect(isVoidishReturn('Promise<User>')).toBe(false)
  })

  test('splitTopLevel ignores nested commas', () => {
    expect(splitTopLevel('a, b')).toEqual(['a', 'b'])
    expect(splitTopLevel('Record<string, X>, y')).toEqual([
      'Record<string, X>',
      'y',
    ])
    // The `>` of an arrow `=>` must not be treated as a closing generic.
    expect(splitTopLevel('a: (x: X) => Y, b: Z')).toEqual([
      'a: (x: X) => Y',
      'b: Z',
    ])
    expect(splitTopLevel('')).toEqual([])
  })

  test('paramName', () => {
    expect(paramName('port?: number')).toBe('port')
    expect(paramName('...rest: T[]')).toBe('rest')
    expect(paramName('x: string')).toBe('x')
    expect(paramName('{ a, b }: Opts')).toBe('')
  })

  test('parseSignature', () => {
    expect(
      parseSignature('listen(port?: number, options?: ListenOptions): Server'),
    ).toEqual({
      params: ['port', 'options'],
      typeParams: [],
      returnType: 'Server',
    })
    expect(parseSignature('create<T>(x: T): Promise<T>')).toEqual({
      params: ['x'],
      typeParams: ['T'],
      returnType: 'Promise<T>',
    })
    expect(parseSignature('name: string').returnType).toBe('string')
    // A callback param before another param must not swallow it (arrow `=>` fix).
    expect(
      parseSignature('sse(source: (c: C) => void, options?: O): Response')
        .params,
    ).toEqual(['source', 'options'])
  })

  test('parseJsDoc extracts summary and tags', () => {
    const doc = parseJsDoc(`/**
     * Does a thing.
     * @typeParam T - the element type.
     * @param a - the first.
     * @returns the result.
     */`)
    expect(doc.summary).toBe('Does a thing.')
    expect([...doc.params]).toEqual(['a'])
    expect([...doc.typeParams]).toEqual(['T'])
    expect(doc.hasReturns).toBe(true)
  })

  test('reexportTargets', () => {
    expect(
      reexportTargets("export { A } from './app';\nexport * from './aop';"),
    ).toEqual(['app', 'aop'])
  })

  test('entryDtsFiles reads the exports map', () => {
    const pkg = {
      exports: {
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        './otel': { types: './dist/otel.d.ts' },
        './package.json': './package.json',
      },
    }
    expect(entryDtsFiles(pkg).sort()).toEqual(['index.d.ts', 'otel.d.ts'])
  })
})

describe('analyzeDtsText', () => {
  test('flags an undocumented export', () => {
    expect(gaps('export declare function foo(a: string): number;\n')).toEqual([
      'foo: missing doc summary',
    ])
  })

  test('flags a documented callable missing @param and @returns', () => {
    const dts =
      '/** Does a thing. */\nexport declare function foo(a: string): number;\n'
    expect(gaps(dts)).toEqual([
      'foo: missing @param a',
      'foo: missing @returns',
    ])
  })

  test('passes a fully documented callable', () => {
    const dts = `/**
 * Does a thing.
 * @param a - the input.
 * @returns the count.
 */
export declare function foo(a: string): number;
`
    expect(gaps(dts)).toEqual([])
  })

  test('a void return needs no @returns', () => {
    const dts =
      '/** Does. @param a - x. */\nexport declare function foo(a: string): void;\n'
    expect(gaps(dts)).toEqual([])
  })

  test('flags a missing @typeParam', () => {
    const dts =
      '/** Make. @param x - val. @returns it. */\nexport declare function make<T>(x: T): T;\n'
    expect(gaps(dts)).toEqual(['make: missing @typeParam T'])
  })

  test('checks interface members, skips already-documented ones', () => {
    const dts = `/** An I. */
export interface I {
    /** The name. */
    name: string;
    age: number;
}
`
    expect(gaps(dts)).toEqual(['I.age: missing doc summary'])
  })

  test('skips private/protected class members', () => {
    const dts = `/** A class. */
export declare class C {
    /** The public one. */
    pub: string;
    private secret: number;
    protected helper(): void;
}
`
    expect(gaps(dts)).toEqual([])
  })

  test('overload group: the union of params must be documented once', () => {
    const full = `/**
 * Read a value.
 * @param k - the key.
 * @param f - the fallback.
 * @returns the value.
 */
export declare function value(k: string): string;
export declare function value(k: string, f: number): number;
`
    expect(gaps(full)).toEqual([])

    const partial = `/**
 * Read a value.
 * @param k - the key.
 * @returns the value.
 */
export declare function value(k: string): string;
export declare function value(k: string, f: number): number;
`
    expect(gaps(partial)).toEqual(['value: missing @param f'])
  })

  test('a documented constructor with a doc summary passes (params not required)', () => {
    const dts = `/** A class. */
export declare class C {
    /** Build one. */
    constructor(a: string, b: number);
}
`
    expect(gaps(dts)).toEqual([])
  })
})
