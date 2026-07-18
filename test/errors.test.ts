import { describe, expect, spyOn, test } from "bun:test";
import {
  BadRequestError,
  catchError,
  type Context,
  controller,
  createApp,
  type ErrorHandler,
  get,
  type Guard,
  HttpError,
  NotFoundError,
  use,
} from "../src/framework";

class DomainError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "DomainError";
  }
}
class OtherError extends Error {}

@controller("/e")
class ErrController {
  @get("/http")
  http() {
    throw new NotFoundError("no widget");
  }

  @get("/detailed")
  detailed() {
    throw new HttpError(409, "duplicate email", {
      code: "duplicate",
      details: { field: "email" },
    });
  }

  @get("/boom")
  boom() {
    throw new Error("kaboom internal secret");
  }

  @get("/resp")
  resp() {
    throw new Response("nope", { status: 418 });
  }

  @get("/ok")
  ok(_ctx: Context) {
    return { ok: true };
  }
}

describe("default error rendering", () => {
  const app = createApp({ controllers: [ErrController] });

  test("an HttpError subclass renders its status + message", async () => {
    const res = await (await app).handle(new Request("http://t/e/http"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { message: "no widget" } });
  });

  test("HttpError carries code + details into the envelope", async () => {
    const res = await (await app).handle(new Request("http://t/e/detailed"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { message: "duplicate email", code: "duplicate", details: { field: "email" } },
    });
  });

  test("a non-HttpError throws an opaque 500 (no message leak) and logs", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    const res = await (await app).handle(new Request("http://t/e/boom"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: { message: "Internal Server Error" } });
    expect(JSON.stringify(body)).not.toContain("secret"); // internal detail not leaked
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("a thrown Response passes straight through", async () => {
    const res = await (await app).handle(new Request("http://t/e/resp"));
    expect(res.status).toBe(418);
    expect(await res.text()).toBe("nope");
  });

  test("unknown route 404s with the error envelope", async () => {
    const res = await (await app).handle(new Request("http://t/e/missing"));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { message: expect.any(String) } });
  });

  test("wrong method 405s with an Allow header and envelope", async () => {
    const res = await (await app).handle(
      new Request("http://t/e/ok", { method: "POST" })
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET");
    expect(await res.json()).toMatchObject({ error: { message: "Method Not Allowed" } });
  });
});

describe("errors thrown in guards", () => {
  const boom: Guard = () => {
    throw new BadRequestError("guard rejected");
  };

  @controller("/g")
  @use(boom)
  class GuardErrController {
    @get("/")
    route() {
      return { ok: true };
    }
  }

  test("a guard's thrown HttpError is rendered like any other", async () => {
    const app = await createApp({ controllers: [GuardErrController] });
    const res = await app.handle(new Request("http://t/g"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { message: "guard rejected" } });
  });
});

describe("global error handlers", () => {
  @controller("/d")
  class DomainController {
    @get("/domain")
    domain() {
      throw new DomainError("bad thing");
    }

    @get("/http")
    http() {
      throw new NotFoundError("missing");
    }
  }

  const onError: ErrorHandler = (err) => {
    if (err instanceof DomainError) {
      return Response.json({ oops: err.reason }, { status: 400 });
    }
  };

  test("createApp({ onError }) maps a matching error", async () => {
    const app = await createApp({ controllers: [DomainController], onError });
    const res = await app.handle(new Request("http://t/d/domain"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ oops: "bad thing" });
  });

  test("returning nothing falls through to the default renderer", async () => {
    const app = await createApp({ controllers: [DomainController], onError });
    const res = await app.handle(new Request("http://t/d/http"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { message: "missing" } });
  });

  test("app.onError() registers a handler after creation", async () => {
    const app = await createApp({ controllers: [DomainController] });
    app.onError(onError);
    const res = await app.handle(new Request("http://t/d/domain"));
    expect(await res.json()).toEqual({ oops: "bad thing" });
  });
});

describe("scoped @catchError", () => {
  const classCatch: ErrorHandler = (err) =>
    err instanceof DomainError ? Response.json({ scope: "class" }, { status: 400 }) : undefined;
  const methodCatch: ErrorHandler = (err) =>
    err instanceof DomainError ? Response.json({ scope: "method" }, { status: 400 }) : undefined;
  const globalCatch: ErrorHandler = (err) =>
    err instanceof OtherError ? Response.json({ scope: "global" }, { status: 400 }) : undefined;

  @controller("/s")
  @catchError(classCatch)
  class ScopedController {
    @get("/class")
    viaClass() {
      throw new DomainError("x");
    }

    @get("/method")
    @catchError(methodCatch)
    viaMethod() {
      throw new DomainError("y");
    }

    @get("/fallthrough")
    fallthrough() {
      throw new NotFoundError("deep");
    }

    @get("/toglobal")
    toGlobal() {
      throw new OtherError("z");
    }
  }

  const app = createApp({ controllers: [ScopedController], onError: globalCatch });

  test("a controller-scoped handler catches its routes' errors", async () => {
    const res = await (await app).handle(new Request("http://t/s/class"));
    expect(await res.json()).toEqual({ scope: "class" });
  });

  test("a method-scoped handler takes precedence over the class one", async () => {
    const res = await (await app).handle(new Request("http://t/s/method"));
    expect(await res.json()).toEqual({ scope: "method" });
  });

  test("a scoped handler that defers falls through to the default", async () => {
    const res = await (await app).handle(new Request("http://t/s/fallthrough"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { message: "deep" } });
  });

  test("a scoped handler that defers reaches the global handler", async () => {
    const res = await (await app).handle(new Request("http://t/s/toglobal"));
    expect(await res.json()).toEqual({ scope: "global" });
  });
});

describe("an error handler that itself throws", () => {
  const rethrow: ErrorHandler = () => {
    throw new BadRequestError("from handler");
  };

  @controller("/th")
  @catchError(rethrow)
  class ThrowController {
    @get("/")
    route() {
      throw new Error("original");
    }
  }

  test("the newly thrown error is rendered instead", async () => {
    const app = await createApp({ controllers: [ThrowController] });
    const res = await app.handle(new Request("http://t/th"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { message: "from handler" } });
  });
});
