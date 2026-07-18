import { describe, expect, test } from "bun:test";
import {
  type Context,
  controller,
  createApp,
  get,
  type Guard,
  use,
} from "../src/framework";

@controller("/r")
class ResponseController {
  @get("/created")
  created(ctx: Context) {
    ctx.set.status = 201;
    return { ok: true };
  }

  @get("/created-str")
  createdStr(ctx: Context) {
    ctx.set.status = 201;
    return "made";
  }

  @get("/status-ignored")
  statusIgnored(ctx: Context) {
    ctx.set.status = 201; // ignored: a returned Response controls its own status
    return new Response("raw", { status: 202 });
  }

  @get("/headers")
  headers(ctx: Context) {
    ctx.set.headers.set("x-custom", "hi");
    ctx.set.headers.set("cache-control", "no-store");
    return { ok: true };
  }

  @get("/headers-on-response")
  headersOnResponse(ctx: Context) {
    ctx.set.headers.set("x-added", "yes");
    return new Response("raw", { headers: { "x-original": "1" } });
  }

  @get("/read-cookie")
  readCookie(ctx: Context) {
    return { session: ctx.cookies.get("session") ?? null, all: ctx.cookies.all() };
  }

  @get("/set-cookie")
  setCookie(ctx: Context) {
    ctx.cookies.set("session", "abc123", {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 3600,
    });
    return { ok: true };
  }

  @get("/set-many")
  setMany(ctx: Context) {
    ctx.cookies.set("a", "1");
    ctx.cookies.set("b", "2");
    return { ok: true };
  }

  @get("/set-encoded")
  setEncoded(ctx: Context) {
    ctx.cookies.set("data", "a b=c;d");
    return { ok: true };
  }

  @get("/clear-cookie")
  clearCookie(ctx: Context) {
    ctx.cookies.delete("session");
    return { ok: true };
  }

  @get("/cookie-204")
  cookie204(ctx: Context) {
    ctx.cookies.set("flash", "gone");
    return null;
  }
}

const app = await createApp({ controllers: [ResponseController] });
const GET = (path: string, init?: RequestInit) =>
  app.handle(new Request(`http://t${path}`, init));

describe("ctx.set.status", () => {
  test("overrides a coerced object's status", async () => {
    const res = await GET("/r/created");
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("overrides a coerced string's status", async () => {
    const res = await GET("/r/created-str");
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("made");
  });

  test("is ignored when the handler returns a Response", async () => {
    const res = await GET("/r/status-ignored");
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("raw");
  });
});

describe("ctx.set.headers", () => {
  test("are merged onto a coerced response", async () => {
    const res = await GET("/r/headers");
    expect(res.headers.get("x-custom")).toBe("hi");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
  });

  test("are merged onto a returned Response, keeping its own headers", async () => {
    const res = await GET("/r/headers-on-response");
    expect(res.headers.get("x-added")).toBe("yes");
    expect(res.headers.get("x-original")).toBe("1");
    expect(await res.text()).toBe("raw");
  });
});

describe("ctx.cookies (reading)", () => {
  test("reads incoming cookies", async () => {
    const res = await GET("/r/read-cookie", {
      headers: { cookie: "session=xyz; theme=dark" },
    });
    expect(await res.json()).toEqual({
      session: "xyz",
      all: { session: "xyz", theme: "dark" },
    });
  });

  test("missing cookie reads as null", async () => {
    const res = await GET("/r/read-cookie");
    expect((await res.json()).session).toBeNull();
  });
});

describe("ctx.cookies (writing)", () => {
  test("set() writes a Set-Cookie with its attributes", async () => {
    const res = await GET("/r/set-cookie");
    const cookie = res.headers.getSetCookie()[0];
    expect(cookie).toContain("session=abc123");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=3600");
  });

  test("multiple cookies produce multiple Set-Cookie headers", async () => {
    const res = await GET("/r/set-many");
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("a=1");
    expect(cookies[1]).toContain("b=2");
  });

  test("cookie values are URL-encoded", async () => {
    const res = await GET("/r/set-encoded");
    const cookie = res.headers.getSetCookie()[0];
    expect(cookie).toContain("data=a%20b%3Dc%3Bd");
  });

  test("delete() expires the cookie", async () => {
    const res = await GET("/r/clear-cookie");
    const cookie = res.headers.getSetCookie()[0];
    expect(cookie).toContain("session=;");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Expires=Thu, 01 Jan 1970");
  });

  test("cookies apply even to a 204 response", async () => {
    const res = await GET("/r/cookie-204");
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie()[0]).toContain("flash=gone");
  });
});

describe("cookies set during a short-circuiting guard", () => {
  const setCookieGuard: Guard = (ctx) => {
    ctx.cookies.set("guard", "yes");
    return new Response("blocked", { status: 403 });
  };

  @controller("/rg")
  @use(setCookieGuard)
  class GuardCookieController {
    @get("/")
    route() {
      return { ok: true };
    }
  }

  test("are still applied to the guard's response", async () => {
    const gapp = await createApp({ controllers: [GuardCookieController] });
    const res = await gapp.handle(new Request("http://t/rg"));
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()[0]).toContain("guard=yes");
  });
});
