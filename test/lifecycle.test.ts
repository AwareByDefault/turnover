import { describe, expect, test } from "bun:test";
import { controller, createApp, get } from "../src/framework";

@controller("/l")
class LController {
  @get("/")
  route() {
    return { ok: true };
  }
}

describe("onRequest (pre-routing)", () => {
  test("can short-circuit before routing", async () => {
    const app = await createApp({
      controllers: [LController],
      onRequest: [
        (req) =>
          new URL(req.url).searchParams.has("block")
            ? new Response("blocked", { status: 403 })
            : undefined,
      ],
    });
    expect((await app.handle(new Request("http://t/l?block=1"))).status).toBe(403);
    expect((await app.handle(new Request("http://t/l"))).status).toBe(200);
  });

  test("runs even for routes that will 404", async () => {
    const seen: string[] = [];
    const app = await createApp({
      controllers: [LController],
      onRequest: [
        (req) => {
          seen.push(new URL(req.url).pathname);
        },
      ],
    });
    const res = await app.handle(new Request("http://t/nope"));
    expect(res.status).toBe(404);
    expect(seen).toEqual(["/nope"]); // hook ran before routing
  });

  test("app.onRequest() registers after creation; first Response wins", async () => {
    const order: string[] = [];
    const app = await createApp({ controllers: [LController] });
    app.onRequest(
      () => {
        order.push("a");
      },
      () => {
        order.push("b");
        return new Response("b", { status: 418 });
      },
      () => {
        order.push("c");
      }
    );
    const res = await app.handle(new Request("http://t/l"));
    expect(res.status).toBe(418);
    expect(order).toEqual(["a", "b"]); // "c" never runs
  });
});

describe("onStart / onStop", () => {
  test("onStart runs on listen(), onStop on stop()", async () => {
    const events: string[] = [];
    const app = await createApp({
      controllers: [LController],
      onStart: [
        () => {
          events.push("start");
        },
      ],
      onStop: [
        () => {
          events.push("stop");
        },
      ],
    });
    app.listen(0);
    expect(events).toEqual(["start"]);
    await app.stop();
    expect(events).toEqual(["start", "stop"]);
  });

  test("onStart receives the running server", async () => {
    let seenPort = 0;
    const app = await createApp({
      controllers: [LController],
      onStart: [
        (server) => {
          seenPort = server.port ?? 0;
        },
      ],
    });
    const server = app.listen(0);
    try {
      expect(seenPort).toBeGreaterThan(0);
      expect(seenPort).toBe(server.port ?? 0);
    } finally {
      await app.stop();
    }
  });
});
