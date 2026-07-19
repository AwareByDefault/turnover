/**
 * Keeps the numbered best-practices docs internally consistent so `N.M` rules
 * stay citable (CLAUDE.md asks reviewers to cite them). Verifies, per doc:
 *
 *   - `## N.` section headers run 1, 2, 3, … with no gaps or duplicates,
 *   - every `- **N.M` rule sits under section `N` and its minor numbers run
 *     1, 2, 3, … within that section,
 *
 * and, across the repo, that every `§N` / `§N.M` citation resolves to a real
 * section/rule in one of those docs (citations are cross-doc, e.g. "testing
 * §3", so they resolve against the union). Deliberately has no `--fix`:
 * renumbering silently invalidates outside citations, so it reports and lets a
 * human decide (see linting-best-practices §8). Escape a line with an
 * `allow: numbering` comment.
 *
 * Runnable directly or via `bun tools/lint/index.ts`.
 */
import { join } from 'node:path'

const HEADER = /^## (\d+)\. /
const RULE = /^- \*\*(\d+)\.(\d+)\b/
const FENCE = /^\s*```/
const CITE = /§(\d+)(?:\.(\d+))?/g
const ALLOW = /(?:\/\/|<!--|\/\*)\s*allow:\s*numbering/i

/** A numbering or citation problem, with a 1-based line (0 = whole doc). */
export interface NumberingIssue {
  readonly doc: string
  readonly line: number
  readonly message: string
}

/** Collected section numbers ("3") and rule numbers ("3.2") across the docs. */
export interface Anchors {
  readonly sections: Set<string>
  readonly rules: Set<string>
}

/** Verify a single doc's section/rule numbering is gapless and well-nested. */
export function checkDoc(doc: string, text: string): NumberingIssue[] {
  const issues: NumberingIssue[] = []
  const lines = text.split('\n')
  let inFence = false
  let expectedSection = 1
  let currentSection = 0
  let expectedMinor = 1
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    const prev = i > 0 ? (lines[i - 1] ?? '') : ''
    if (FENCE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence || ALLOW.test(line) || ALLOW.test(prev)) continue

    const header = HEADER.exec(line)
    if (header) {
      const num = Number(header[1])
      if (num !== expectedSection) {
        issues.push({
          doc,
          line: i + 1,
          message: `section "## ${num}." is out of sequence — expected ${expectedSection}`,
        })
      }
      expectedSection = num + 1
      currentSection = num
      expectedMinor = 1
      continue
    }

    const rule = RULE.exec(line)
    if (rule) {
      const major = Number(rule[1])
      const minor = Number(rule[2])
      if (major !== currentSection) {
        issues.push({
          doc,
          line: i + 1,
          message: `rule ${major}.${minor} is under section ${currentSection} — its major must match the section`,
        })
      } else if (minor !== expectedMinor) {
        issues.push({
          doc,
          line: i + 1,
          message: `rule ${major}.${minor} is out of sequence — expected ${major}.${expectedMinor}`,
        })
        expectedMinor = minor + 1
      } else {
        expectedMinor = minor + 1
      }
    }
  }
  return issues
}

/** Add a doc's section and rule numbers to the shared anchor sets. */
export function collectAnchors(text: string, anchors: Anchors): void {
  const lines = text.split('\n')
  let inFence = false
  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const header = HEADER.exec(line)
    if (header?.[1]) anchors.sections.add(header[1])
    const rule = RULE.exec(line)
    if (rule?.[1] && rule[2]) anchors.rules.add(`${rule[1]}.${rule[2]}`)
  }
}

/** Find citations in text that don't resolve to any known section/rule. */
export function checkCitations(
  doc: string,
  text: string,
  anchors: Anchors,
): NumberingIssue[] {
  const issues: NumberingIssue[] = []
  const lines = text.split('\n')
  let inFence = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    const prev = i > 0 ? (lines[i - 1] ?? '') : ''
    if (FENCE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence || ALLOW.test(line) || ALLOW.test(prev)) continue
    for (const match of line.matchAll(CITE)) {
      const major = match[1] ?? ''
      const minor = match[2]
      if (minor !== undefined) {
        if (!anchors.rules.has(`${major}.${minor}`)) {
          issues.push({
            doc,
            line: i + 1,
            message: `citation §${major}.${minor} resolves to no best-practices rule`,
          })
        }
      } else if (!anchors.sections.has(major)) {
        issues.push({
          doc,
          line: i + 1,
          message: `citation §${major} resolves to no best-practices section`,
        })
      }
    }
  }
  return issues
}

const DOCS: readonly string[] = [
  'contributing/coding-best-practices.md',
  'contributing/testing-best-practices.md',
  'contributing/linting-best-practices.md',
]

/** Files scanned for `§N` / `§N.M` citations. */
const CITE_GLOBS: readonly string[] = [
  'contributing/**/*.md',
  'README.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'src/**/*.ts',
]

async function run(): Promise<number> {
  const root = join(import.meta.dir, '..', '..', '..')
  const issues: NumberingIssue[] = []
  const anchors: Anchors = { sections: new Set(), rules: new Set() }

  for (const doc of DOCS) {
    const text = await Bun.file(join(root, doc)).text()
    issues.push(...checkDoc(doc, text))
    collectAnchors(text, anchors)
  }

  const seen = new Set<string>()
  for (const glob of CITE_GLOBS) {
    for await (const path of new Bun.Glob(glob).scan({
      cwd: root,
      absolute: true,
    })) {
      if (seen.has(path)) continue
      seen.add(path)
      if (path.includes('/node_modules/') || path.includes('/dist/')) continue
      const rel = path.slice(root.length + 1)
      issues.push(...checkCitations(rel, await Bun.file(path).text(), anchors))
    }
  }

  if (issues.length > 0) {
    for (const issue of issues) {
      process.stderr.write(`${issue.doc}:${issue.line}: ${issue.message}\n`)
    }
    process.stderr.write(
      `\nbest-practices-numbering failed: ${issues.length} issue(s).\n`,
    )
    return 1
  }
  process.stdout.write('best-practices-numbering passed\n')
  return 0
}

if (import.meta.main) process.exit(await run())
