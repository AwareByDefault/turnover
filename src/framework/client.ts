/**
 * A minimal, dependency-free typed HTTP client driven by an
 * `openapi-typescript`-generated `paths` type. Turnover can't infer client types
 * through decorators, so the typed client is codegen-based:
 *
 * 1. Extract the spec: `Bun.write("openapi.json", JSON.stringify(app.openapi({ toJsonSchema })))`
 * 2. Generate types: `bunx openapi-typescript openapi.json -o api.d.ts`
 * 3. `const api = createClient<paths>({ baseUrl })` — fully typed calls.
 */

// biome-ignore lint/suspicious/noExplicitAny: `paths` types are opaque; extraction uses conditional inference
type Any = any;

/** Extract the `application/json` type from an OpenAPI content object. */
type JsonContent<T> = T extends { content: { "application/json": infer C } } ? C : never;

/** The operation object for a path + method, if present. */
type Operation<Paths, P extends keyof Paths, M extends string> = M extends keyof Paths[P]
  ? Paths[P][M]
  : never;

/** Paths in `Paths` that define the given method. */
type PathsWith<Paths, M extends string> = {
  [P in keyof Paths]: M extends keyof Paths[P] ? P : never;
}[keyof Paths];

/** The success (200/201) JSON response type of an operation. */
type ResponseOf<Op> = Op extends { responses: infer R }
  ? R extends { 200: infer Res }
    ? JsonContent<Res>
    : R extends { 201: infer Res }
      ? JsonContent<Res>
      : unknown
  : unknown;

/** Per-call options derived from an operation's parameters and request body. */
type RequestOptions<Op> = (Op extends { parameters: infer P }
  ? { params: P }
  : { params?: never }) &
  (Op extends { requestBody: infer B } ? { body: JsonContent<B> } : { body?: never }) & {
    headers?: Record<string, string>;
  };

/** Whether an operation requires options (has path params or a body). */
type NeedsOptions<Op> = Op extends { parameters: { path: unknown } }
  ? true
  : Op extends { requestBody: unknown }
    ? true
    : false;

/** The result of a request: `data` on success, `error` on a non-2xx. */
export interface ClientResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

type ClientMethod<Paths, M extends string> = <P extends PathsWith<Paths, M>>(
  path: P,
  ...args: NeedsOptions<Operation<Paths, P, M>> extends true
    ? [options: RequestOptions<Operation<Paths, P, M>>]
    : [options?: RequestOptions<Operation<Paths, P, M>>]
) => Promise<ClientResult<ResponseOf<Operation<Paths, P, M>>>>;

/** A typed client over an `openapi-typescript` `paths` type. */
export interface Client<Paths> {
  get: ClientMethod<Paths, "get">;
  post: ClientMethod<Paths, "post">;
  put: ClientMethod<Paths, "put">;
  patch: ClientMethod<Paths, "patch">;
  delete: ClientMethod<Paths, "delete">;
}

export interface ClientConfig {
  baseUrl: string;
  headers?: Record<string, string>;
  /** Override the fetch implementation (e.g. `app.handle` in tests). */
  fetch?: (request: Request) => Promise<Response>;
}

/** Create a typed client for an API described by an `openapi-typescript` `paths` type. */
export function createClient<Paths>(config: ClientConfig): Client<Paths> {
  const base = config.baseUrl.replace(/\/$/, "");

  const request = async (
    method: string,
    path: string,
    options?: { params?: Any; body?: unknown; headers?: Record<string, string> }
  ): Promise<ClientResult<unknown>> => {
    let url = base + path;
    const pathParams = options?.params?.path as Record<string, unknown> | undefined;
    if (pathParams) {
      for (const [key, val] of Object.entries(pathParams)) {
        url = url.replace(`{${key}}`, encodeURIComponent(String(val)));
      }
    }
    const query = options?.params?.query as Record<string, unknown> | undefined;
    if (query) {
      const parts: string[] = [];
      for (const [key, val] of Object.entries(query)) {
        if (val !== undefined && val !== null) {
          parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
        }
      }
      if (parts.length > 0) url += `?${parts.join("&")}`;
    }

    const headers: Record<string, string> = { ...config.headers, ...options?.headers };
    const init: RequestInit = { method: method.toUpperCase(), headers };
    if (options?.body !== undefined) {
      init.body = JSON.stringify(options.body);
      headers["content-type"] = "application/json";
    }

    const req = new Request(url, init);
    const response = config.fetch ? await config.fetch(req) : await fetch(req);
    const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
    const payload = isJson ? await response.json() : await response.text();
    return response.ok ? { data: payload, response } : { error: payload, response };
  };

  return {
    get: (path, options) => request("get", path as string, options as Any),
    post: (path, options) => request("post", path as string, options as Any),
    put: (path, options) => request("put", path as string, options as Any),
    patch: (path, options) => request("patch", path as string, options as Any),
    delete: (path, options) => request("delete", path as string, options as Any),
  } as Client<Paths>;
}
