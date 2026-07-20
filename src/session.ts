import { AsyncLocalStorage } from 'node:async_hooks'
import type { Plugin } from './app'
import { type CookieOptions, Cookies } from './cookies'
import { injectable } from './di'
import type { Interceptor } from './http'

/** Data bag persisted for one session; values must be JSON-serializable once a non-memory {@link SessionStore} (e.g. Redis) round-trips them. */
export type SessionData = Record<string, unknown>

/**
 * Pluggable session backend. Async so a real store (Redis, a database) can back
 * it; {@link memorySessionStore} is the in-process default.
 */
export interface SessionStore {
  /**
   * Load a session's data, or `undefined` if absent/expired.
   *
   * @param id - The session id to load.
   * @returns The session's data, or `undefined` if absent or expired.
   */
  get(id: string): Promise<SessionData | undefined>
  /**
   * Persist a session's data. The {@link session} plugin calls this at request
   * end only when the session is dirty, so a TTL-based store should refresh the
   * entry's expiry here (lifetime slides on write, not on read).
   *
   * @param id - The session id to store under.
   * @param data - The full data bag to persist, replacing any prior value for `id`.
   */
  set(id: string, data: SessionData): Promise<void>
  /**
   * Remove a session. Called on {@link Session.destroy} (logout) and, after
   * {@link Session.regenerate}, on the superseded old id. Should be idempotent.
   *
   * @param id - The session id to remove.
   */
  destroy(id: string): Promise<void>
}

/**
 * In-memory {@link SessionStore} backed by a `Map`. Fine for a single process or
 * tests; use a shared store (Redis, a database) across replicas.
 *
 * @param options - `ttl` is the lifetime in **seconds** (stored internally as
 *   ms); it is refreshed on every write, so idle read-only requests do not
 *   extend it. Omit `ttl` for sessions that never expire. Expired entries are
 *   purged lazily on the next {@link SessionStore.get}, not on a timer.
 */
export function memorySessionStore(
  options: { ttl?: number } = {},
): SessionStore {
  const ttlMs = options.ttl !== undefined ? options.ttl * 1000 : undefined
  const map = new Map<string, { data: SessionData; expires: number }>()
  return {
    async get(id) {
      const entry = map.get(id)
      if (!entry) return undefined
      if (entry.expires !== 0 && entry.expires < Date.now()) {
        map.delete(id)
        return undefined
      }
      return entry.data
    },
    async set(id, data) {
      map.set(id, { data, expires: ttlMs ? Date.now() + ttlMs : 0 })
    },
    async destroy(id) {
      map.delete(id)
    },
  }
}

/** Mutable working state for the current request's session. */
interface SessionState {
  /** Persisted id, or `undefined` until a write mints one (lazy creation). */
  id: string | undefined
  /** The previous id after {@link Session.regenerate}, destroyed on persist. */
  oldId: string | undefined
  data: SessionData
  dirty: boolean
  destroyed: boolean
}

const sessionStorage = new AsyncLocalStorage<SessionState>()

/** Options for {@link session}. */
export interface SessionOptions {
  /** Backing store (default {@link memorySessionStore}). */
  store?: SessionStore
  /** Session-id cookie name (default `"sid"`). */
  cookie?: string
  /**
   * Cookie attributes. Defaults to `HttpOnly`, `SameSite=Lax`, `Path=/`. Add
   * `secure: true` in production (HTTPS).
   */
  cookieOptions?: CookieOptions
}

/**
 * Request-scoped session accessor. A singleton, but every method reads the
 * *current* request's session from `AsyncLocalStorage`, so injecting it into a
 * singleton controller still yields per-request data. Requires the
 * {@link session} plugin to be installed.
 *
 * ```ts
 * class Auth {
 *   private readonly session = inject(Session)
 *   @post('/login') login() { this.session.set('userId', '42') }   // mints a session
 *   @post('/logout') logout() { this.session.destroy() }           // clears it
 * }
 * ```
 */
@injectable()
export class Session {
  private current(): SessionState {
    const state = sessionStorage.getStore()
    if (!state) {
      throw new Error(
        'Session was accessed outside a request, or the session() plugin is not installed.',
      )
    }
    return state
  }

  /** The session id, or `undefined` before anything is stored. */
  get id(): string | undefined {
    return this.current().id
  }

  /** The whole data bag (mutating it directly does not mark the session dirty). */
  get data(): SessionData {
    return this.current().data
  }

  /**
   * Read a stored value by key. `T` is an **unchecked cast** — the value is not
   * validated at runtime — so narrow or validate untrusted session data yourself.
   *
   * @typeParam T - Asserted type of the stored value (cast, not verified).
   * @param key - The key to read from the session data.
   * @returns The stored value, or `undefined` if the key is unset.
   */
  get<T = unknown>(key: string): T | undefined {
    return this.current().data[key] as T | undefined
  }

  /**
   * Store a value. The first write mints a session id and flags the session
   * dirty, so the {@link session} plugin persists it and sends the cookie at
   * request end; it also cancels a {@link destroy} made earlier in the request.
   *
   * @param key - The key to store the value under.
   * @param value - The value to store.
   */
  set(key: string, value: unknown): void {
    const state = this.current()
    state.data[key] = value
    state.dirty = true
    state.destroyed = false
    state.id ??= crypto.randomUUID()
  }

  /**
   * Remove a single value and flag the session dirty. Removes only this key, not
   * the session; unlike {@link set} it never mints an id, so deleting on a
   * session that was never written persists nothing.
   *
   * @param key - The key to remove from the session data.
   */
  delete(key: string): void {
    const state = this.current()
    delete state.data[key]
    state.dirty = true
  }

  /** Drop all values but keep the session (and its id). */
  clear(): void {
    const state = this.current()
    state.data = {}
    state.dirty = true
  }

  /**
   * Issue a fresh id while keeping the data — call right after authenticating to
   * defend against session fixation. The old id is destroyed on persist.
   */
  regenerate(): void {
    const state = this.current()
    if (state.id) state.oldId = state.id
    state.id = crypto.randomUUID()
    state.dirty = true
  }

  /** Destroy the session and expire its cookie (log the user out). */
  destroy(): void {
    const state = this.current()
    state.destroyed = true
  }
}

/**
 * Plugin: cookie-based sessions backed by a {@link SessionStore}. Loads the
 * session named by the id cookie before the handler runs, exposes it through the
 * injectable {@link Session}, and persists changes afterwards — setting the
 * cookie when a session is first written, and expiring it on
 * {@link Session.destroy}. Sessions are created lazily, so an anonymous request
 * that never writes gets no cookie and no store entry.
 *
 * ```ts
 * const app = await createApp({ plugins: [session()] })
 * ```
 *
 * @param options - Store, cookie name, and cookie attribute overrides.
 * @returns A plugin that loads, exposes, and persists the per-request session.
 */
export function session(options: SessionOptions = {}): Plugin {
  const store = options.store ?? memorySessionStore()
  const cookieName = options.cookie ?? 'sid'
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    ...options.cookieOptions,
  }

  const serialize = (value: string): string => {
    const jar = new Cookies(null)
    jar.set(cookieName, value, cookieOptions)
    return jar.serialize()[0] as string
  }
  const serializeClear = (): string => {
    const { httpOnly, secure, sameSite, path, domain } = cookieOptions
    const jar = new Cookies(null)
    jar.delete(cookieName, { httpOnly, secure, sameSite, path, domain })
    return jar.serialize()[0] as string
  }

  const wrap: Interceptor = async (ctx, next) => {
    const cookieId = ctx.cookies.get(cookieName)
    let id: string | undefined
    let data: SessionData = {}
    if (cookieId) {
      const loaded = await store.get(cookieId)
      if (loaded) {
        id = cookieId
        data = loaded
      }
    }
    const state: SessionState = {
      id,
      oldId: undefined,
      data,
      dirty: false,
      destroyed: false,
    }

    const res = await sessionStorage.run(state, () => next())

    let setCookie: string | undefined
    if (state.destroyed) {
      if (state.id) await store.destroy(state.id)
      if (cookieId) setCookie = serializeClear()
    } else if (state.dirty && state.id) {
      if (state.oldId && state.oldId !== state.id)
        await store.destroy(state.oldId)
      await store.set(state.id, state.data)
      setCookie = serialize(state.id)
    }

    if (!setCookie) return res
    // applyOutgoing already merged ctx.cookies, so add ours to the final response.
    const headers = new Headers(res.headers)
    headers.append('set-cookie', setCookie)
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    })
  }

  return { wrap }
}
