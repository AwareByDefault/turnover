import { describe, expect, test } from "bun:test";
import {
  type Context,
  controller,
  createApp,
  get,
  type Guard,
  module,
} from "../src/framework";

declare module "../src/framework/request" {
  interface RequestStore {
    area?: string;
  }
}

const auth: Guard = (ctx) => {
  if (ctx.req.headers.get("authorization") !== "ok") {
    return new Response("no", { status: 401 });
  }
};

@controller("/users")
class MUsersController {
  @get("/")
  list() {
    return { users: ["a"] };
  }

  @get("/:id")
  one(ctx: Context) {
    return { id: ctx.params.id };
  }
}

@controller("/roles")
class MRolesController {
  @get("/")
  list() {
    return { roles: ["admin"] };
  }
}

@module({
  prefix: "/admin",
  use: [auth],
  controllers: [MUsersController, MRolesController],
})
class AdminModule {}

describe("a module mounts controllers under a prefix", () => {
  const app = createApp({ modules: [AdminModule] });
  const GET = async (p: string, authed = true) =>
    (await app).handle(
      new Request(`http://t${p}`, authed ? { headers: { authorization: "ok" } } : undefined)
    );

  test("controllers mount under the module prefix", async () => {
    expect(await (await GET("/admin/users")).json()).toEqual({ users: ["a"] });
    expect(await (await GET("/admin/roles")).json()).toEqual({ roles: ["admin"] });
  });

  test("prefix + controller base + route param compose", async () => {
    expect(await (await GET("/admin/users/7")).json()).toEqual({ id: "7" });
  });

  test("the module guard applies to every route", async () => {
    expect((await GET("/admin/users", false)).status).toBe(401);
    expect((await GET("/admin/roles", false)).status).toBe(401);
  });

  test("the un-prefixed path does not exist", async () => {
    expect((await GET("/users")).status).toBe(404);
  });
});

@controller("/reports")
class MReportsController {
  @get("/")
  list(ctx: Context) {
    return { area: ctx.store.area };
  }

  @get("/boom")
  boom() {
    throw new Error("kaboom");
  }
}

@module({
  prefix: "/analytics",
  derive: [() => ({ area: "analytics" })],
  catchError: [
    (err) =>
      err instanceof Error ? Response.json({ handled: true }, { status: 500 }) : undefined,
  ],
  controllers: [MReportsController],
})
class AnalyticsModule {}

describe("module-level derive & catchError", () => {
  const app = createApp({ modules: [AnalyticsModule] });

  test("a module deriver populates ctx.store for its routes", async () => {
    const res = await (await app).handle(new Request("http://t/analytics/reports"));
    expect(await res.json()).toEqual({ area: "analytics" });
  });

  test("a module error handler catches its routes' errors", async () => {
    const res = await (await app).handle(new Request("http://t/analytics/reports/boom"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ handled: true });
  });
});

@module({ prefix: "/v1", use: [auth], modules: [AnalyticsModule] })
class ApiModule {}

describe("nested modules", () => {
  const app = createApp({ modules: [ApiModule] });

  test("prefixes compose across nesting", async () => {
    const res = await (await app).handle(
      new Request("http://t/v1/analytics/reports", { headers: { authorization: "ok" } })
    );
    expect(await res.json()).toEqual({ area: "analytics" });
  });

  test("a nested module inherits the parent's guard", async () => {
    const res = await (await app).handle(new Request("http://t/v1/analytics/reports"));
    expect(res.status).toBe(401); // parent's auth guard, no header
  });
});

@controller("/ping")
class MPingController {
  @get("/")
  ping() {
    return { pong: true };
  }
}

@module({ prefix: "/shared", controllers: [MPingController] })
class SharedModule {}
@module({ prefix: "/a", modules: [SharedModule] })
class AModule {}
@module({ prefix: "/b", modules: [SharedModule] })
class BModule {}

describe("a shared module can mount under multiple parents (diamond)", () => {
  const app = createApp({ modules: [AModule, BModule] });

  test("it mounts under both prefixes", async () => {
    expect((await (await app).handle(new Request("http://t/a/shared/ping"))).status).toBe(200);
    expect((await (await app).handle(new Request("http://t/b/shared/ping"))).status).toBe(200);
  });
});

@controller("/health")
class MHealthController {
  @get("/")
  health() {
    return { ok: true };
  }
}

describe("modules and explicit controllers coexist", () => {
  test("both are mounted", async () => {
    const app = await createApp({
      modules: [AdminModule],
      controllers: [MHealthController],
    });
    expect((await app.handle(new Request("http://t/health"))).status).toBe(200);
    expect(
      (
        await app.handle(
          new Request("http://t/admin/users", { headers: { authorization: "ok" } })
        )
      ).status
    ).toBe(200);
  });

  test("a module with no prefix mounts at the controller base", async () => {
    @module({ controllers: [MHealthController] })
    class RootModule {}
    const app = await createApp({ modules: [RootModule] });
    expect(await (await app.handle(new Request("http://t/health"))).json()).toEqual({
      ok: true,
    });
  });
});
