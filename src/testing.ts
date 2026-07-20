// Test helpers for exercising a turnover app in-memory, without opening a
// socket. Available at the `turnover/testing` subpath (kept out of the main
// barrel so it never ships in a production bundle).

/** Anything with a WinterTC-style `handle` — an `App`, or a bare fetch handler wrapper. */
export interface Handleable {
  /**
   * Handle one request and return its response.
   * @param request - The incoming request to handle.
   * @returns The response, synchronously or as a promise.
   */
  handle(request: Request): Response | Promise<Response>
}

/** Per-request options for a {@link TestClient} call. */
export interface TestRequestOptions {
  /** Extra headers for this request (merged over the client defaults). */
  headers?: Record<string, string>
  /** Query parameters appended to the path. */
  query?: Record<string, string | number | boolean>
}

/**
 * A response wrapper that can be read more than once (each accessor clones), so
 * a test can assert on the status, headers, and body together.
 */
export interface TestResponse {
  /** The HTTP status code. */
  readonly status: number
  /** The response headers. */
  readonly headers: Headers
  /** The underlying `Response` (body unread). */
  readonly raw: Response
  /**
   * Read and parse the body as JSON (clones, so it can be called repeatedly).
   * @typeParam T - The expected shape of the parsed JSON body.
   * @returns The parsed body.
   */
  json<T = unknown>(): Promise<T>
  /**
   * Read the body as text (clones, so it can be called repeatedly).
   * @returns The body decoded as text.
   */
  text(): Promise<string>
}

/** An ergonomic in-memory client over an app's `handle`. */
export interface TestClient {
  /**
   * Send a request with an explicit method — the general form behind the verb helpers.
   * @param method - The HTTP method to use.
   * @param path - The request path, relative to the client's base URL.
   * @param options - Headers, query parameters, and an optional body.
   */
  request(
    method: string,
    path: string,
    options?: TestRequestOptions & { body?: unknown },
  ): Promise<TestResponse>
  /**
   * Send a `GET` request.
   * @param path - The request path, relative to the client's base URL.
   * @param options - Headers and query parameters for this request.
   * @returns The response wrapper.
   */
  get(path: string, options?: TestRequestOptions): Promise<TestResponse>
  /**
   * Send a `DELETE` request.
   * @param path - The request path, relative to the client's base URL.
   * @param options - Headers and query parameters for this request.
   * @returns The response wrapper.
   */
  delete(path: string, options?: TestRequestOptions): Promise<TestResponse>
  /**
   * Send a `POST` request with an optional body.
   * @param path - The request path, relative to the client's base URL.
   * @param body - The request body; JSON-serialized unless already a raw body.
   * @param options - Headers and query parameters for this request.
   * @returns The response wrapper.
   */
  post(
    path: string,
    body?: unknown,
    options?: TestRequestOptions,
  ): Promise<TestResponse>
  /**
   * Send a `PUT` request with an optional body.
   * @param path - The request path, relative to the client's base URL.
   * @param body - The request body; JSON-serialized unless already a raw body.
   * @param options - Headers and query parameters for this request.
   * @returns The response wrapper.
   */
  put(
    path: string,
    body?: unknown,
    options?: TestRequestOptions,
  ): Promise<TestResponse>
  /**
   * Send a `PATCH` request with an optional body.
   * @param path - The request path, relative to the client's base URL.
   * @param body - The request body; JSON-serialized unless already a raw body.
   * @param options - Headers and query parameters for this request.
   * @returns The response wrapper.
   */
  patch(
    path: string,
    body?: unknown,
    options?: TestRequestOptions,
  ): Promise<TestResponse>
}

/** Options for {@link testClient}. */
export interface TestClientOptions {
  /** Base URL for relative paths (default `"http://test.local"`). */
  baseUrl?: string
  /** Headers sent on every request (e.g. an auth token). */
  headers?: Record<string, string>
}

function wrap(response: Response): TestResponse {
  return {
    status: response.status,
    headers: response.headers,
    raw: response,
    // Clone per read so json()/text() can both be called, and more than once.
    json: <T = unknown>() => response.clone().json() as Promise<T>,
    text: () => response.clone().text(),
  }
}

function isRawBody(body: unknown): body is BodyInit {
  return (
    typeof body === 'string' ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  )
}

/**
 * Build an in-memory client for a turnover app — routes requests through
 * `app.handle` with no socket. JSON bodies are serialized and content-typed
 * automatically; strings, `FormData`, and binary bodies pass through untouched.
 * Responses are re-readable so status, headers, and body can all be asserted.
 *
 * ```ts
 * const app = await createApp({ controllers: [Users] })
 * const client = testClient(app, { headers: { authorization: 'Bearer t' } })
 * const res = await client.post('/users', { name: 'Ada' })
 * expect(res.status).toBe(201)
 * expect(await res.json()).toMatchObject({ name: 'Ada' })
 * ```
 *
 * @param app - The app (or anything {@link Handleable}) to route requests through.
 * @param options - Base URL and default headers applied to every request.
 * @returns A {@link TestClient} bound to the app.
 */
export function testClient(
  app: Handleable,
  options: TestClientOptions = {},
): TestClient {
  const baseUrl = options.baseUrl ?? 'http://test.local'

  const build = (
    method: string,
    path: string,
    opts: TestRequestOptions & { body?: unknown } = {},
  ): Request => {
    const url = new URL(path, baseUrl)
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        url.searchParams.set(key, String(value))
      }
    }
    const headers = new Headers({ ...options.headers, ...opts.headers })
    const init: RequestInit = { method, headers }
    if (opts.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      if (isRawBody(opts.body)) {
        init.body = opts.body
      } else {
        init.body = JSON.stringify(opts.body)
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/json')
        }
      }
    }
    return new Request(url, init)
  }

  const send = async (
    method: string,
    path: string,
    opts?: TestRequestOptions & { body?: unknown },
  ): Promise<TestResponse> => wrap(await app.handle(build(method, path, opts)))

  return {
    request: send,
    get: (path, opts) => send('GET', path, opts),
    delete: (path, opts) => send('DELETE', path, opts),
    post: (path, body, opts) => send('POST', path, { ...opts, body }),
    put: (path, body, opts) => send('PUT', path, { ...opts, body }),
    patch: (path, body, opts) => send('PATCH', path, { ...opts, body }),
  }
}
