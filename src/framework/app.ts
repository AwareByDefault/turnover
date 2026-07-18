import { pathToFileURL } from "node:url";
import { Container } from "./di";
import {
  type Context,
  type ControllerMeta,
  type Guard,
  registeredControllers,
} from "./http";
import {
  CLASS_GUARDS,
  type Ctor,
  METHOD_GUARDS,
  metadataOf,
  ROUTES,
  type RouteMeta,
} from "./metadata";
import { type RequestState, runInRequest } from "./request";

export interface CreateAppOptions {
  /** Directory to scan for `@controller` files. Defaults to the entry's dir. */
  dir?: string;
  /**
   * Provide controller classes explicitly instead of scanning. Pass the
   * imported classes (importing them runs their decorators). Bundler-friendly.
   */
  controllers?: Ctor[];
  /** Reuse an existing container. */
  container?: Container;
}

type BunHandler = (
  req: Request & { params: Record<string, string> }
) => Promise<Response>;

/** Join a controller base and a route path into one normalized pattern. */
function joinPath(base: string, path: string): string {
  const joined = `/${base}/${path}`
    .replace(/\/{2,}/g, "/") // collapse duplicate slashes
    .replace(/(.+)\/$/, "$1"); // drop trailing slash (except root)
  return joined || "/";
}

async function parseBody<T>(req: Request): Promise<T> {
  const raw = await req.text();
  if (raw === "") return undefined as T;
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
  }
  return raw as T;
}

/** Turn a handler's return value into a Response. */
function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  if (result == null) return new Response(null, { status: 204 });
  if (typeof result === "string") return new Response(result);
  return Response.json(result as Record<string, unknown>);
}

export class App {
  readonly container: Container;
  private readonly routes: Record<string, Record<string, BunHandler>> = {};

  constructor(container: Container) {
    this.container = container;
  }

  /** Instantiate a controller (with DI) and wire its routes + guards. */
  mount(meta: ControllerMeta): void {
    const instance = this.container.resolve(meta.target) as Record<
      string | symbol,
      (ctx: Context) => unknown
    >;
    // Routes and guards live in the class metadata, read here (after every
    // decorator on the class has run), so decorator order does not matter.
    const bag = metadataOf(meta.target);
    const routes = (bag?.[ROUTES] as RouteMeta[] | undefined) ?? [];
    const classGuards = (bag?.[CLASS_GUARDS] as Guard[] | undefined) ?? [];
    const methodGuards =
      (bag?.[METHOD_GUARDS] as Map<PropertyKey, Guard[]> | undefined) ??
      new Map<PropertyKey, Guard[]>();

    for (const { method, path, handlerName } of routes) {
      const pattern = joinPath(meta.base, path);
      const handler = instance[handlerName];
      const guards = [...classGuards, ...(methodGuards.get(handlerName) ?? [])];

      this.routes[pattern] ??= {};
      const methods = this.routes[pattern];
      methods[method] = (req) => {
        const state: RequestState = { req, principal: null };
        return runInRequest(state, async () => {
          const ctx: Context = {
            req,
            params: req.params ?? {},
            query: new URL(req.url).searchParams,
            body: <T = unknown>() => parseBody<T>(req),
          };
          try {
            for (const guard of guards) {
              const short = await guard(ctx);
              if (short instanceof Response) return short;
            }
            return toResponse(await handler.call(instance, ctx));
          } catch (err) {
            // Handlers/guards may `throw` a Response (e.g. Auth.user's 401).
            if (err instanceof Response) return err;
            throw err;
          }
        });
      };
    }
  }

  /** A `{ pattern: [methods] }` view of what's mounted — handy for logging. */
  routeTable(): Record<string, string[]> {
    const table: Record<string, string[]> = {};
    for (const [pattern, methods] of Object.entries(this.routes)) {
      table[pattern] = Object.keys(methods);
    }
    return table;
  }

  listen(port = 3000) {
    return Bun.serve({ port, routes: this.routes as never });
  }
}

/** Scan `dir` for files that use `@controller(...)` and import them. */
async function discover(dir: string): Promise<void> {
  const glob = new Bun.Glob("**/*.ts");
  for await (const rel of glob.scan({ cwd: dir })) {
    const abs = `${dir}/${rel}`;
    const source = await Bun.file(abs).text();
    if (!/@controller\s*\(/.test(source)) continue;
    await import(pathToFileURL(abs).href); // import -> @controller self-registers
  }
}

/** The directory of the entry script, used as the default scan root. */
function entryDir(): string {
  const main = Bun.main; // absolute path of the entry file
  return main.slice(0, main.lastIndexOf("/"));
}

/**
 * Create an app: discover controllers (or take them explicitly), instantiate
 * each through the DI container, and build the route table. Call `.listen()` to
 * start a `Bun.serve` server.
 */
export async function createApp(options: CreateAppOptions = {}): Promise<App> {
  const container = options.container ?? new Container();
  if (!options.controllers) {
    await discover(options.dir ?? entryDir());
  }
  const app = new App(container);
  for (const meta of registeredControllers()) app.mount(meta);
  return app;
}
