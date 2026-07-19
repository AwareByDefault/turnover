import type { ServerWebSocket } from 'bun'

/** A live WebSocket connection — Bun's `ServerWebSocket`, typed with your data. */
export type WebSocketConnection<Data = unknown> = ServerWebSocket<Data>

/**
 * A WebSocket endpoint served alongside the HTTP routes. Register it via
 * `createApp({ websocket })` (or `app.websocket(route)`); `listen()` upgrades
 * matching requests and dispatches the lifecycle callbacks. To multiplex several
 * logical channels, inspect the request in {@link WebSocketRoute.upgrade} and
 * stash a discriminator in the returned `data`.
 *
 * ```ts
 * const chat: WebSocketRoute<{ user: string }> = {
 *   path: '/ws',
 *   upgrade: (req) => ({ user: new URL(req.url).searchParams.get('user') ?? 'anon' }),
 *   open: (ws) => ws.send(`welcome ${ws.data.user}`),
 *   message: (ws, msg) => ws.send(`echo: ${msg}`),
 * }
 * const app = await createApp({ websocket: chat })
 * ```
 */
export interface WebSocketRoute<Data = unknown> {
  /** Only upgrade requests whose pathname equals this. Omit to match any path. */
  path?: string
  /**
   * Decide whether to accept the upgrade and what data to attach to the
   * connection (readable as `ws.data`). Return `undefined` to reject the upgrade
   * with `401`. When omitted, every matching request is accepted with `undefined`
   * data. Runs before the socket opens, so it's the place to authenticate.
   */
  upgrade?(req: Request): Data | undefined | Promise<Data | undefined>
  /** The connection opened. */
  open?(ws: WebSocketConnection<Data>): void | Promise<void>
  /** A message arrived (text as `string`, binary as `Buffer`). */
  message?(
    ws: WebSocketConnection<Data>,
    message: string | Buffer,
  ): void | Promise<void>
  /** The connection closed. */
  close?(
    ws: WebSocketConnection<Data>,
    code: number,
    reason: string,
  ): void | Promise<void>
  /** The socket's send buffer drained (backpressure relieved). */
  drain?(ws: WebSocketConnection<Data>): void | Promise<void>
}
