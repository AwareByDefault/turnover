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
   *
   * @param req - The incoming upgrade request to inspect (headers, URL, auth).
   * @returns The data to attach to the connection, or `undefined` to reject with `401`.
   */
  upgrade?(req: Request): Data | undefined | Promise<Data | undefined>
  /**
   * Runs once after a successful upgrade, before any message. `ws.data` holds
   * whatever {@link WebSocketRoute.upgrade} returned — send a greeting or seed
   * per-connection state here.
   *
   * @param ws - The newly opened connection; `ws.data` carries the upgrade result.
   * @returns Nothing; may return a promise for async work.
   */
  open?(ws: WebSocketConnection<Data>): void | Promise<void>
  /**
   * A message frame arrived — called once per frame. Text frames arrive as a
   * `string`, binary frames as a `Buffer`; branch on `typeof message`.
   *
   * @param ws - The connection the message arrived on.
   * @param message - The payload: text as `string`, binary as `Buffer`.
   * @returns Nothing; may return a promise for async work.
   */
  message?(
    ws: WebSocketConnection<Data>,
    message: string | Buffer,
  ): void | Promise<void>
  /**
   * Runs once when the connection closes, cleanly or on error; no further sends
   * reach the client. Release per-connection resources here.
   *
   * @param ws - The connection that closed.
   * @param code - The WebSocket close code (e.g. `1000` normal, `1001` going away, `1006` abnormal/no close frame).
   * @param reason - The peer's UTF-8 close reason; empty string when none was sent.
   * @returns Nothing; may return a promise for async work.
   */
  close?(
    ws: WebSocketConnection<Data>,
    code: number,
    reason: string,
  ): void | Promise<void>
  /**
   * The send buffer drained after a `ws.send()` reported backpressure — resume
   * sending any data you paused here.
   *
   * @param ws - The connection whose send buffer drained.
   * @returns Nothing; may return a promise for async work.
   */
  drain?(ws: WebSocketConnection<Data>): void | Promise<void>
}
