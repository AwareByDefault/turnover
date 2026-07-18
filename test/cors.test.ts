import { describe, expect, spyOn, test } from "bun:test";
import { controller, cors, createApp, get, type Plugin } from "../src/framework";

@controller("/c")
class CController {
  @get("/")
  ok() {
    return { ok: true };
  }

  @get("/boom")
  boom() {
    throw new Error("kaboom");
  }
}

describe("onResponse hook", () => {
  test("can add a header to the response", async () => {
    const app = await createApp({
      controllers: [CController],
      onResponse: [(res) => void res.headers.set("x-powered-by", "turnover")],
    });
    const res = await app.handle(new Request("http://t/c"));
    expect(res.headers.get("x-powered-by")).toBe("turnover");
  });

  test("can replace the response", async () => {
    const app = await createApp({
      controllers: [CController],
      onResponse: [() => new Response("replaced")],
    });
    const res = await app.handle(new Request("http://t/c"));
    expect(await res.text()).toBe("replaced");
  });

  test("runs on 404s and error responses", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    const seen: number[] = [];
    const app = await createApp({
      controllers: [CController],
      onResponse: [(res) => void seen.push(res.status)],
    });
    await app.handle(new Request("http://t/missing"));
    await app.handle(new Request("http://t/c/boom"));
    expect(seen).toEqual([404, 500]);
    spy.mockRestore();
  });

  test("app.onResponse() registers after creation, in order", async () => {
    const order: string[] = [];
    const app = await createApp({ controllers: [CController] });
    app.onResponse(
      () => void order.push("a"),
      () => void order.push("b")
    );
    await app.handle(new Request("http://t/c"));
    expect(order).toEqual(["a", "b"]);
  });
});

describe("plugins", () => {
  test("app.register() wires a plugin's hooks", async () => {
    const marks: string[] = [];
    const plugin: Plugin = {
      onRequest: [() => void marks.push("req")],
      onResponse: [() => void marks.push("res")],
    };
    const app = await createApp({ controllers: [CController] });
    app.register(plugin);
    await app.handle(new Request("http://t/c"));
    expect(marks).toEqual(["req", "res"]);
  });

  test("createApp({ plugins }) registers them", async () => {
    const marks: string[] = [];
    const app = await createApp({
      controllers: [CController],
      plugins: [{ onResponse: [() => void marks.push("res")] }],
    });
    await app.handle(new Request("http://t/c"));
    expect(marks).toEqual(["res"]);
  });
});

describe("cors()", () => {
  const corsApp = (opts?: Parameters<typeof cors>[0]) =>
    createApp({ controllers: [CController], plugins: [cors(opts)] });
  const withOrigin = (path: string, origin = "https://x.com", init?: RequestInit) =>
    new Request(`http://t${path}`, {
      ...init,
      headers: { origin, ...(init?.headers as Record<string, string>) },
    });

  test("answers preflight with 204 + CORS headers", async () => {
    const app = await corsApp();
    const res = await app.handle(
      withOrigin("/c", "https://x.com", {
        method: "OPTIONS",
        headers: {
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      })
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://x.com");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toBe("content-type");
  });

  test("reflects the origin on an actual request", async () => {
    const app = await corsApp();
    const res = await app.handle(withOrigin("/c"));
    expect(res.headers.get("access-control-allow-origin")).toBe("https://x.com");
    expect(await res.json()).toEqual({ ok: true });
  });

  test("adds no CORS headers when there is no Origin", async () => {
    const app = await corsApp();
    const res = await app.handle(new Request("http://t/c"));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("an allow-list denies unlisted origins", async () => {
    const app = await corsApp({ origin: ["https://good.com"] });
    const allowed = await app.handle(withOrigin("/c", "https://good.com"));
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://good.com");
    const denied = await app.handle(withOrigin("/c", "https://evil.com"));
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("a fixed origin string is set verbatim", async () => {
    const app = await corsApp({ origin: "*" });
    const res = await app.handle(withOrigin("/c"));
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("credentials, maxAge, and exposedHeaders are applied", async () => {
    const app = await corsApp({
      origin: "https://x.com",
      credentials: true,
      maxAge: 600,
      exposedHeaders: ["x-total"],
    });
    const pre = await app.handle(
      withOrigin("/c", "https://x.com", {
        method: "OPTIONS",
        headers: { "access-control-request-method": "GET" },
      })
    );
    expect(pre.headers.get("access-control-max-age")).toBe("600");
    expect(pre.headers.get("access-control-allow-credentials")).toBe("true");

    const res = await app.handle(withOrigin("/c"));
    expect(res.headers.get("access-control-expose-headers")).toBe("x-total");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  test("CORS headers are added to error/404 responses too", async () => {
    const app = await corsApp();
    const res = await app.handle(withOrigin("/missing"));
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://x.com");
  });
});
