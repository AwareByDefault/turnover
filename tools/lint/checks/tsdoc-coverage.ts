/**
 * Enforces 100% TSDoc coverage — and signature-driven richness — on turnover's
 * public API (coding §6.3, §6.4). Biome and `tsc` can't see doc completeness, so
 * this reads the **emitted `.d.ts`** (exactly what consumers install) and flags:
 *
 *   - any exported symbol, or public member of an exported class/interface, with
 *     no doc summary;
 *   - any documented callable missing an `@param` for a parameter, a `@typeParam`
 *     for a type parameter, or an `@returns` for a non-`void` return.
 *
 * The public surface is derived from `package.json` `exports` — the entry `.d.ts`
 * of each subpath — then expanded by following each entry's `export … from './x'`
 * re-exports, so a new subpath or re-exported module is covered automatically (no
 * hard-coded module list to drift). Reading `.d.ts` instead of source means no
 * dependence on the compiler API, and the same {@link analyzeDtsText} powers the
 * build smoke test (`test/tsdoc-dist.smoke.test.ts`), proving the docs survive
 * `tsc`.
 *
 * Coverage is 100% by design — there is no per-symbol escape. Runnable directly or
 * via `bun tools/lint/index.ts`.
 */
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import packageJson from '../../../package.json'

/** A single documentation gap, reported as `file:line: symbol — message`. */
export interface DocViolation {
  /** The `.d.ts` file (basename) the flagged declaration lives in. */
  readonly file: string
  /** 1-based line of the flagged declaration within that file. */
  readonly line: number
  /** The symbol/member path that is under-documented (e.g. `App.listen`). */
  readonly symbol: string
  /** What is missing (no summary, missing `@param x`, …). */
  readonly message: string
}

/** Return types that need no `@returns` tag. */
const VOIDISH = new Set(['void', 'undefined', 'never', 'this', 'Promise<void>'])

/** Whether a return type (as printed in the `.d.ts`) needs no `@returns`. */
export function isVoidishReturn(typeText: string): boolean {
  return VOIDISH.has(typeText.trim())
}

/**
 * Split a comma-separated list at top level only, ignoring commas nested in
 * `()`, `<>`, `{}`, `[]`, or string literals.
 *
 * @param text - the raw list contents (without the enclosing brackets).
 * @returns the top-level segments, trimmed; `[]` for an empty/blank list.
 */
export function splitTopLevel(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  let quote = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch
    else if (ch === '(' || ch === '<' || ch === '{' || ch === '[') depth += 1
    else if (ch === ')' || ch === '>' || ch === '}' || ch === ']') depth -= 1
    else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  const tail = text.slice(start).trim()
  if (tail) out.push(tail)
  return out
}

/** Extract the balanced `(...)`/`<...>` span starting at `open` in `text`. */
function balancedSpan(
  text: string,
  openIdx: number,
): { inner: string; end: number } {
  const open = text[openIdx] ?? ''
  const close = open === '(' ? ')' : '>'
  let depth = 0
  for (let i = openIdx; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return { inner: text.slice(openIdx + 1, i), end: i }
    }
  }
  return { inner: text.slice(openIdx + 1), end: text.length }
}

/** The leading parameter name of a single parameter segment, or '' to skip. */
export function paramName(segment: string): string {
  const s = segment.replace(/^\.\.\./, '').trimStart()
  // Destructured params ({a} / [a]) have no single name to document.
  if (s.startsWith('{') || s.startsWith('[')) return ''
  return /^([A-Za-z_$][\w$]*)\??\s*[:)]?/.exec(s)?.[1] ?? ''
}

/** A callable's documentable signature, parsed from a `.d.ts` header. */
export interface ParsedSignature {
  /** Parameter names (destructured params, which can't be named, are omitted). */
  readonly params: string[]
  /** Type-parameter names. */
  readonly typeParams: string[]
  /** The printed return type, or '' when none is annotated. */
  readonly returnType: string
}

/**
 * Parse the parameter names, type parameters, and return type from a callable
 * declaration header (everything up to the trailing `;`/`{`).
 *
 * @param header - the accumulated declaration text, e.g. `listen(port?: number): Server`.
 * @returns the parsed {@link ParsedSignature}.
 */
export function parseSignature(header: string): ParsedSignature {
  const nameMatch = /^(?:new\s+)?[A-Za-z_$][\w$]*/.exec(header.trim())
  let rest = header
    .trim()
    .slice(nameMatch?.[0].length ?? 0)
    .trimStart()
  const typeParams: string[] = []
  if (rest.startsWith('<')) {
    const { inner, end } = balancedSpan(rest, 0)
    for (const seg of splitTopLevel(inner)) {
      const id = /^([A-Za-z_$][\w$]*)/.exec(seg.trim())?.[1]
      if (id) typeParams.push(id)
    }
    rest = rest.slice(end + 1).trimStart()
  }
  const params: string[] = []
  let returnType = ''
  const parenIdx = rest.indexOf('(')
  if (parenIdx !== -1) {
    const { inner, end } = balancedSpan(rest, parenIdx)
    for (const seg of splitTopLevel(inner)) {
      const name = paramName(seg)
      if (name && name !== 'this') params.push(name)
    }
    const after = rest.slice(end + 1).trimStart()
    if (after.startsWith(':')) {
      returnType = after
        .slice(1)
        .replace(/[;{]\s*$/, '')
        .trim()
    }
  } else {
    // A property: `name: Type`.
    const colon = rest.indexOf(':')
    if (colon !== -1)
      returnType = rest
        .slice(colon + 1)
        .replace(/;\s*$/, '')
        .trim()
  }
  return { params, typeParams, returnType }
}

/** The summary + relevant tags parsed from one JSDoc block. */
export interface ParsedDoc {
  /** The summary text (before any tag); empty if the block is tags-only. */
  readonly summary: string
  /** Names given an `@param` tag. */
  readonly params: Set<string>
  /** Names given an `@typeParam`/`@template` tag. */
  readonly typeParams: Set<string>
  /** Whether an `@returns`/`@return` tag is present. */
  readonly hasReturns: boolean
}

/**
 * Parse a raw JSDoc block (`/**` … `*` /`) into its summary and TSDoc tags.
 *
 * @param block - the full comment text including delimiters.
 * @returns the parsed {@link ParsedDoc}.
 */
export function parseJsDoc(block: string): ParsedDoc {
  const cleaned = block
    .replace(/^\s*\/\*\*+/, '')
    .replace(/\*+\/\s*$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*?\s?/, ''))
    .join('\n')
  const params = new Set<string>()
  const typeParams = new Set<string>()
  for (const m of cleaned.matchAll(/@param\s+([A-Za-z_$][\w$]*)/g)) {
    if (m[1]) params.add(m[1])
  }
  for (const m of cleaned.matchAll(
    /@(?:typeParam|template)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    if (m[1]) typeParams.add(m[1])
  }
  const hasReturns = /@returns?\b/.test(cleaned)
  // The summary is everything before the first block tag (inline or on its own line).
  const firstTag = cleaned.search(/(?:^|\s)@\w+/)
  const summary = (firstTag === -1 ? cleaned : cleaned.slice(0, firstTag))
    .replace(/\s+/g, ' ')
    .trim()
  return {
    summary,
    params,
    typeParams,
    hasReturns,
  }
}

/** Net `{`/`}` depth change on a `.d.ts` line (no string/brace escaping needed). */
function netBraces(line: string): number {
  let n = 0
  for (const ch of line) {
    if (ch === '{') n += 1
    else if (ch === '}') n -= 1
  }
  return n
}

interface Container {
  readonly kind: 'class' | 'interface' | 'enum'
  readonly name: string
  readonly bodyDepth: number
}

interface Callable {
  readonly kind: 'function' | 'method'
  readonly name: string
  readonly containerKey: string
  jsdoc: ParsedDoc | null
  params: Set<string>
  typeParams: Set<string>
  nonVoid: boolean
  readonly file: string
  readonly line: number
  readonly symbol: string
}

/**
 * Analyze one `.d.ts` file's text and return every documentation gap in it.
 *
 * @param file - the file's basename, used in reported violations.
 * @param text - the full `.d.ts` source.
 * @returns the {@link DocViolation}s found, in source order.
 */
export function analyzeDtsText(file: string, text: string): DocViolation[] {
  const lines = text.split('\n')
  const violations: DocViolation[] = []
  const stack: Container[] = []
  let depth = 0
  let pending: ParsedDoc | null = null
  let group: Callable | null = null

  const containerPath = (): string => stack.map((c) => c.name).join('.')
  const flush = (): void => {
    if (!group) return
    const { jsdoc } = group
    if (!jsdoc?.summary) {
      violations.push({
        file,
        line: group.line,
        symbol: group.symbol,
        message: 'missing doc summary',
      })
    } else {
      for (const p of group.params) {
        if (!jsdoc.params.has(p)) {
          violations.push({
            file,
            line: group.line,
            symbol: group.symbol,
            message: `missing @param ${p}`,
          })
        }
      }
      for (const tp of group.typeParams) {
        if (!jsdoc.typeParams.has(tp)) {
          violations.push({
            file,
            line: group.line,
            symbol: group.symbol,
            message: `missing @typeParam ${tp}`,
          })
        }
      }
      if (group.nonVoid && !jsdoc.hasReturns) {
        violations.push({
          file,
          line: group.line,
          symbol: group.symbol,
          message: 'missing @returns',
        })
      }
    }
    group = null
  }
  const leaf = (symbol: string, line: number): void => {
    if (!pending?.summary) {
      violations.push({ file, line, symbol, message: 'missing doc summary' })
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? ''
    const t = raw.trim()
    if (t === '') continue
    if (t.startsWith('/*')) {
      const start = i
      while (i < lines.length && !(lines[i] ?? '').includes('*/')) i += 1
      const block = lines.slice(start, i + 1).join('\n')
      if (block.trimStart().startsWith('/**')) pending = parseJsDoc(block)
      continue
    }
    if (
      t.startsWith('import ') ||
      t.startsWith('export {') ||
      t.startsWith('export type {') ||
      t.startsWith('export *') ||
      t.startsWith('export default')
    ) {
      flush()
      pending = null
      depth += netBraces(raw)
      while (stack.length && depth < (stack[stack.length - 1]?.bodyDepth ?? 0))
        stack.pop()
      continue
    }

    // Accumulate a multi-line header until the signature is balanced and ends.
    let header = t
    let end = i
    const balanced = (s: string): boolean => {
      let d = 0
      let q = ''
      for (const ch of s) {
        if (q) {
          if (ch === q) q = ''
        } else if (ch === '"' || ch === "'" || ch === '`') q = ch
        else if ('(<[{'.includes(ch)) d += 1
        else if (')>]}'.includes(ch)) d -= 1
      }
      return d <= 0
    }
    while (
      !/[;{]\s*$/.test(header) &&
      !balanced(header) &&
      end + 1 < lines.length
    ) {
      end += 1
      header = `${header} ${(lines[end] ?? '').trim()}`
    }

    const inContainer =
      stack.length > 0 && depth === (stack[stack.length - 1]?.bodyDepth ?? -1)
    const opensBody = /\{\s*$/.test(header)
    const top = stack[stack.length - 1]

    let handled = false
    if (stack.length === 0 && depth === 0) {
      // Top-level declaration.
      const m =
        /^export (?:declare )?(?:abstract )?(class|interface|enum|function|const|type|namespace) (\w+)/.exec(
          header,
        )
      if (m) {
        const [, kind = '', name = ''] = m
        if (kind === 'class' || kind === 'interface' || kind === 'enum') {
          flush()
          leaf(name, i + 1)
          pending = null
          handled = true
          // Push after depth update below.
        } else if (kind === 'function') {
          const sig = parseSignature(
            header.replace(/^export (?:declare )?function\s+/, ''),
          )
          registerCallable('function', name, 'ext', sig, i + 1, name)
          handled = true
        } else {
          // const / type / namespace → leaf (summary only).
          flush()
          leaf(name, i + 1)
          pending = null
          handled = true
        }
      }
    } else if (inContainer && top) {
      // Member of a class/interface/enum.
      if (!/^(private|protected)\b/.test(t) && !t.startsWith('#')) {
        const member = t.replace(/^(static|readonly|abstract)\s+/g, '')
        const accessor = /^(get|set) (\w+)/.exec(member)
        const ctor = /^constructor\s*\(/.test(member)
        const method = /^(\w+)\??(<[^(]*>)?\s*\(/.exec(member)
        const prop = /^(\w+)\??\s*:/.exec(member)
        const index = /^\[[^\]]+\]\s*:/.test(member)
        if (top.kind === 'enum') {
          const em = /^(\w+)/.exec(member)?.[1]
          if (em) {
            flush()
            leaf(`${top.name}.${em}`, i + 1)
            pending = null
            handled = true
          }
        } else if (accessor) {
          flush()
          leaf(`${containerPath()}.${accessor[2]}`, i + 1)
          pending = null
          handled = true
        } else if (ctor) {
          // A constructor documents its purpose (summary only); its parameters
          // are either parameter-properties (documented as members below) or
          // construction plumbing, and many types are built via a factory
          // (`createApp`, DI) rather than `new`.
          const sig = parseSignature(
            `constructor${member.slice('constructor'.length)}`,
          )
          flush()
          if (sig.params.length > 0)
            leaf(`${containerPath()}.constructor`, i + 1)
          pending = null
          handled = true
        } else if (method) {
          const sig = parseSignature(member)
          registerCallable(
            'method',
            method[1] ?? '',
            containerPath(),
            sig,
            i + 1,
            `${containerPath()}.${method[1]}`,
          )
          handled = true
        } else if (prop || index) {
          flush()
          leaf(`${containerPath()}.${prop?.[1] ?? '[index]'}`, i + 1)
          pending = null
          handled = true
        }
      } else {
        flush()
        pending = null
        handled = true
      }
    }

    if (!handled) {
      flush()
      pending = null
    }

    // Update depth over the consumed header lines.
    for (let k = i; k <= end; k += 1) depth += netBraces(lines[k] ?? '')
    // Push a container after its opening brace is counted.
    if (handled && stack.length === 0 && opensBody) {
      const m =
        /^export (?:declare )?(?:abstract )?(class|interface|enum) (\w+)/.exec(
          header,
        )
      if (m) {
        const kind = m[1] as 'class' | 'interface' | 'enum'
        stack.push({ kind, name: m[2] ?? '', bodyDepth: depth })
      }
    }
    while (stack.length && depth < (stack[stack.length - 1]?.bodyDepth ?? 0))
      stack.pop()
    i = end
  }
  flush()
  return violations

  function registerCallable(
    kind: 'function' | 'method',
    name: string,
    containerKey: string,
    sig: ParsedSignature,
    line: number,
    symbol: string,
  ): void {
    const nonVoid = sig.returnType !== '' && !isVoidishReturn(sig.returnType)
    if (
      group &&
      group.kind === kind &&
      group.name === name &&
      group.containerKey === containerKey &&
      !pending
    ) {
      // Overload sibling — merge into the group (its doc is on the first).
      for (const p of sig.params) group.params.add(p)
      for (const tp of sig.typeParams) group.typeParams.add(tp)
      group.nonVoid = group.nonVoid || nonVoid
      return
    }
    flush()
    group = {
      kind,
      name,
      containerKey,
      jsdoc: pending,
      params: new Set(sig.params),
      typeParams: new Set(sig.typeParams),
      nonVoid,
      file,
      line,
      symbol,
    }
    pending = null
  }
}

/** The `.d.ts` module names re-exported by a `.d.ts` (`export … from './x'`). */
export function reexportTargets(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\bfrom\s+['"]\.\/([\w.-]+)['"]/g)) {
    if (m[1]) out.push(m[1])
  }
  return out
}

/**
 * The entry `.d.ts` basenames declared by a package's `exports` map.
 *
 * @param pkg - the parsed `package.json`.
 * @returns the deduplicated `.d.ts` basenames (e.g. `index.d.ts`, `otel.d.ts`).
 */
export function entryDtsFiles(pkg: {
  exports?: Record<string, unknown>
}): string[] {
  const out = new Set<string>()
  for (const value of Object.values(pkg.exports ?? {})) {
    const candidates =
      typeof value === 'string'
        ? [value]
        : Object.values(value as Record<string, string>)
    for (const path of candidates) {
      if (typeof path === 'string' && path.endsWith('.d.ts'))
        out.add(basename(path))
    }
  }
  return [...out]
}

/**
 * Analyze a directory of emitted `.d.ts` files: each entry plus the modules it
 * re-exports (transitively), collecting every documentation gap. Shared by the
 * lint CLI and the build smoke test.
 *
 * @param distDir - directory holding the emitted `.d.ts` files.
 * @param entryBasenames - entry `.d.ts` basenames to start from (see {@link entryDtsFiles}).
 * @returns every {@link DocViolation}, sorted by file then line.
 */
export async function analyzeDtsDir(
  distDir: string,
  entryBasenames: readonly string[],
): Promise<DocViolation[]> {
  const worklist = [...entryBasenames]
  const seen = new Set<string>()
  const violations: DocViolation[] = []
  while (worklist.length > 0) {
    const name = worklist.pop() ?? ''
    if (seen.has(name)) continue
    seen.add(name)
    const file = Bun.file(join(distDir, name))
    if (!(await file.exists())) continue
    const text = await file.text()
    violations.push(...analyzeDtsText(name, text))
    for (const target of reexportTargets(text)) worklist.push(`${target}.d.ts`)
  }
  return violations.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
  )
}

async function run(): Promise<number> {
  const root = join(import.meta.dir, '..', '..', '..')
  const out = join(tmpdir(), 'turnover-tsdoc-dts')
  rmSync(out, { recursive: true, force: true })
  const tsc = join(root, 'node_modules', '.bin', 'tsc')
  const emit = Bun.spawn(
    [
      tsc,
      '-p',
      'tsconfig.build.json',
      '--emitDeclarationOnly',
      '--outDir',
      out,
    ],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' },
  )
  if ((await emit.exited) !== 0) {
    process.stderr.write(await new Response(emit.stderr).text())
    process.stderr.write('tsdoc-coverage: could not emit declarations.\n')
    return 1
  }

  const violations = await analyzeDtsDir(out, entryDtsFiles(packageJson))
  rmSync(out, { recursive: true, force: true })
  if (violations.length > 0) {
    for (const v of violations) {
      process.stderr.write(
        `src/${v.file.replace(/\.d\.ts$/, '.ts')}: ${v.symbol} — ${v.message}\n`,
      )
    }
    process.stderr.write(
      `\ntsdoc-coverage failed: ${violations.length} public API symbol(s) under-documented.\n`,
    )
    return 1
  }
  process.stdout.write('tsdoc-coverage passed (100% public API TSDoc)\n')
  return 0
}

if (import.meta.main) process.exit(await run())
