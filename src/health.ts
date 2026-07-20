import type { Plugin, RequestHook } from './app'
import { type Container, InjectionToken } from './di'

/** A single readiness check. */
export interface HealthCheck {
  /** Identifier reported in the `/ready` payload. */
  name: string
  /** Return truthy if healthy; a falsy result or a throw marks it down. */
  check: () => boolean | Promise<boolean>
}

/**
 * Multi-injection token for readiness checks. Bind a {@link HealthCheck} (a
 * value or an `@injectable` class that implements it) as a provider and
 * {@link health} collects every one it finds, alongside any passed explicitly.
 *
 * ```ts
 * createApp({
 *   providers: [{ provide: HEALTH_CHECK, useClass: DbHealth }],
 *   plugins: [health()],
 * })
 * ```
 */
export const HEALTH_CHECK = new InjectionToken<HealthCheck>('HEALTH_CHECK')

/** Options for the {@link health} plugin. */
export interface HealthOptions {
  /** Extra readiness checks, run on every `/ready` request alongside any {@link HEALTH_CHECK} providers; all run concurrently and every one must pass for a `200`. */
  checks?: HealthCheck[]
  /** Liveness path (the process is serving). Default `/health`. */
  livenessPath?: string
  /** Readiness path (dependencies are up). Default `/ready`. */
  readinessPath?: string
}

/**
 * Plugin: mount liveness and readiness probes. `/health` answers `200` whenever
 * the process is serving (liveness). `/ready` runs every check — those passed in
 * {@link HealthOptions.checks} plus any {@link HEALTH_CHECK} providers bound in
 * the container — and answers `200` when all pass or `503` when any fails, with
 * a per-check breakdown — the shape a load balancer or orchestrator expects.
 *
 * ```ts
 * const app = await createApp({
 *   plugins: [health({ checks: [{ name: 'db', check: () => db.ping() }] })],
 * })
 * // GET /health → 200 {status:"up"}; GET /ready → 200/503 with per-check status
 * ```
 *
 * @param options - Endpoint paths and any explicit readiness checks.
 * @returns A plugin serving the liveness and readiness probe endpoints.
 */
export function health(options: HealthOptions = {}): Plugin {
  const liveness = options.livenessPath ?? '/health'
  const readiness = options.readinessPath ?? '/ready'
  const explicit = options.checks ?? []
  // Filled at registration from any HEALTH_CHECK providers bound in the container.
  let collected: HealthCheck[] = []

  const onInit = (container: Container) => {
    collected = container.resolveAll(HEALTH_CHECK)
  }

  const onRequest: RequestHook = async (req) => {
    const path = new URL(req.url).pathname
    if (path === liveness) {
      return Response.json({ status: 'up' })
    }
    if (path === readiness) {
      const checks = [...explicit, ...collected]
      const results = await Promise.all(
        checks.map(async (item) => {
          let up = false
          try {
            up = Boolean(await item.check())
          } catch {
            up = false
          }
          return { name: item.name, status: up ? 'up' : 'down' }
        }),
      )
      const healthy = results.every((result) => result.status === 'up')
      return Response.json(
        { status: healthy ? 'up' : 'down', checks: results },
        { status: healthy ? 200 : 503 },
      )
    }
    return undefined
  }

  return { onInit, onRequest }
}
