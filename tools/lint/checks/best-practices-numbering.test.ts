import { describe, expect, test } from 'bun:test'
import {
  type Anchors,
  checkCitations,
  checkDoc,
  collectAnchors,
} from './best-practices-numbering'

const GOOD = [
  '# Doc',
  '## 1. First',
  '- **1.1 — one**',
  '- **1.2 — two**',
  '## 2. Second',
  '- **2.1 — one**',
  '',
].join('\n')

describe('checkDoc', () => {
  test('accepts gapless sections and rules', () => {
    expect(checkDoc('doc.md', GOOD)).toEqual([])
  })

  test('flags a gap in section numbering', () => {
    const text = '## 1. A\n## 3. C\n'
    const issues = checkDoc('doc.md', text)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('expected 2')
  })

  test('flags a rule whose major does not match its section', () => {
    const text = '## 1. A\n- **2.1 — wrong section**\n'
    const issues = checkDoc('doc.md', text)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('major must match')
  })

  test('flags a gap in rule minor numbering', () => {
    const text = '## 1. A\n- **1.1 — one**\n- **1.3 — skips two**\n'
    const issues = checkDoc('doc.md', text)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('expected 1.2')
  })

  test('ignores numbering inside fenced code blocks', () => {
    const text = '## 1. A\n```\n## 9. not a real header\n```\n- **1.1 — one**\n'
    expect(checkDoc('doc.md', text)).toEqual([])
  })

  test('honors an allow-numbering escape', () => {
    const text = '## 1. A\n<!-- allow: numbering -->\n## 3. C\n'
    expect(checkDoc('doc.md', text)).toEqual([])
  })
})

describe('citation resolution', () => {
  function anchorsFor(text: string): Anchors {
    const anchors: Anchors = { sections: new Set(), rules: new Set() }
    collectAnchors(text, anchors)
    return anchors
  }

  test('collects section and rule anchors', () => {
    const anchors = anchorsFor(GOOD)
    expect(anchors.sections.has('1')).toBe(true)
    expect(anchors.rules.has('1.2')).toBe(true)
  })

  test('passes a citation that resolves to a known rule', () => {
    const anchors = anchorsFor(GOOD)
    expect(checkCitations('x.md', 'see §1.2 for detail', anchors)).toEqual([])
  })

  test('passes a section-level citation', () => {
    const anchors = anchorsFor(GOOD)
    expect(checkCitations('x.md', 'per §2 above', anchors)).toEqual([])
  })

  test('flags a citation that resolves to nothing', () => {
    const anchors = anchorsFor(GOOD)
    const issues = checkCitations('x.md', 'violates §9.9', anchors)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('§9.9')
  })
})
