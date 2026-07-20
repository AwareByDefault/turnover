---
"turnover": patch
---

Document the entire public API with TSDoc, and enforce it. Every exported symbol
and public member now carries a doc summary, and callables document each parameter,
type parameter, and return value — so the docs consumers see in their editor (via
the shipped `.d.ts`) are complete.

This is mechanically enforced going forward: a new `tsdoc-coverage` lint check
derives the public surface from `package.json` `exports`, reads the emitted `.d.ts`,
and fails on any undocumented symbol or any callable missing an `@param`,
`@typeParam`, or `@returns` (coding §6.3, §6.4). A build smoke test re-verifies the
docs survive `tsc` into the published types at 100% coverage.
