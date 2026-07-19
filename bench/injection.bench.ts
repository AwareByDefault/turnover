// Cost of dependency injection at construction time. Controllers and services
// are singletons — injected once when constructed, then a plain field read per
// request (see the throughput bench: "injected singleton" ≈ "static route").
// So the meaningful DI cost is at construction, and this measures how it scales
// with the number of injected dependencies.

import { Container, inject, injectable } from 'turnover'
import { formatDuration, type Section, time } from './harness'

@injectable()
class Svc0 {}
@injectable()
class Svc1 {}
@injectable()
class Svc2 {}
@injectable()
class Svc3 {}
@injectable()
class Svc4 {}
@injectable()
class Svc5 {}
@injectable()
class Svc6 {}
@injectable()
class Svc7 {}

class Inject0 {}

class Inject1 {
  readonly a = inject(Svc0)
}

class Inject4 {
  readonly a = inject(Svc0)
  readonly b = inject(Svc1)
  readonly c = inject(Svc2)
  readonly d = inject(Svc3)
}

class Inject8 {
  readonly a = inject(Svc0)
  readonly b = inject(Svc1)
  readonly c = inject(Svc2)
  readonly d = inject(Svc3)
  readonly e = inject(Svc4)
  readonly f = inject(Svc5)
  readonly g = inject(Svc6)
  readonly h = inject(Svc7)
}

// Resolve `target` in a fresh container each call, so every call actually
// constructs it (and its dependencies) instead of returning a cached singleton.
const resolveFresh = (target: new () => unknown) => () => {
  new Container().resolve(target)
}

export async function run(options: { quick?: boolean } = {}): Promise<Section> {
  const timing = options.quick
    ? { warmup: 20, rounds: 3, batch: 500 }
    : { warmup: 500, rounds: 30, batch: 5000 }

  const d0 = await time(resolveFresh(Inject0), timing)
  const d1 = await time(resolveFresh(Inject1), timing)
  const d4 = await time(resolveFresh(Inject4), timing)
  const d8 = await time(resolveFresh(Inject8), timing)
  const perDep = (d8.meanNs - d0.meanNs) / 8

  const row = (label: string, ns: number) => ({
    label,
    value: formatDuration(ns),
  })

  return {
    title:
      'Injection — construction cost by dependency count (fresh container)',
    rows: [
      row('resolve, 0 deps', d0.meanNs),
      row('resolve, 1 dep', d1.meanNs),
      row('resolve, 4 deps', d4.meanNs),
      row('resolve, 8 deps', d8.meanNs),
      {
        label: '→ per injected dependency',
        value: formatDuration(perDep),
        note: 'includes constructing the dependency',
      },
    ],
  }
}

if (import.meta.main) {
  const { printSection } = await import('./harness')
  printSection(await run({ quick: Bun.argv.includes('--quick') }))
}
