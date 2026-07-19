import type { Plugin, RequestHook } from './app'

/** A single readiness check. */
export interface HealthCheck {
  /** Identifier reported in the `/ready` payload. */
  name: string
  /** Return truthy if healthy; a falsy result or a throw marks it down. */
  check: () => boolean | Promise<boolean>
}

/** Options for the {@link health} plugin. */
export interface HealthOptions {
  /** Readiness checks aggregated by the readiness endpoint. */
  checks?: HealthCheck[]
  /** Liveness path (the process is serving). Default `/health`. */
  livenessPath?: string
  /** Readiness path (dependencies are up). Default `/ready`. */
  readinessPath?: string
}

/**
 * Plugin: mount liveness and readiness probes. `/health` answers `200` whenever
 * the process is serving (liveness). `/ready` runs every registered check and
 * answers `200` when all pass or `503` when any fails (readiness), with a
 * per-check breakdown — the shape a load balancer or orchestrator expects.
 *
 * ```ts
 * const app = await createApp({
 *   plugins: [health({ checks: [{ name: 'db', check: () => db.ping() }] })],
 * })
 * // GET /health → 200 {status:"up"}; GET /ready → 200/503 with per-check status
 * ```
 */
export function health(options: HealthOptions = {}): Plugin {
  const liveness = options.livenessPath ?? '/health'
  const readiness = options.readinessPath ?? '/ready'
  const checks = options.checks ?? []

  const onRequest: RequestHook = async (req) => {
    const path = new URL(req.url).pathname
    if (path === liveness) {
      return Response.json({ status: 'up' })
    }
    if (path === readiness) {
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

  return { onRequest }
}
