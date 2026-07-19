/**
 * The single source of truth for turnover's custom lint checks — the checks
 * Biome and `tsc` can't express (see contributing/linting-best-practices.md §8
 * for the "cheapest home first" decision tree).
 *
 * Kept deliberately side-effect-free so both the runner (`index.ts`, which runs
 * checks at import time) and any other tooling can import the list without
 * triggering a scan.
 *
 * To add a check: write `checks/<name>.ts`, add `'<name>'` to {@link CHECKS},
 * and bind it in {@link REGISTRY}. The `Record<CheckName, …>` type makes an
 * unregistered check a compile error — every check is traced to what it enforces.
 */

/** Every custom check, by basename of its `checks/<name>.ts` file. */
export const CHECKS = ['best-practices-numbering'] as const

/** A check's name. */
export type CheckName = (typeof CHECKS)[number]

/**
 * What a check enforces, traced to the rule it mechanizes. A check that
 * intentionally enforces no documented rule uses `{ exempt: <reason> }`, so
 * "enforces nothing" is a written claim rather than an empty field.
 */
export type Enforcement =
  | { readonly doc: string; readonly rules: readonly [string, ...string[]] }
  | { readonly exempt: string }

/** Maps every check to the best-practice(s) it mechanizes. */
export const REGISTRY: Record<CheckName, Enforcement> = {
  'best-practices-numbering': {
    doc: 'contributing/linting-best-practices.md',
    rules: ['§8 (mechanical enforcement of the N.M citation scheme)'],
  },
}
