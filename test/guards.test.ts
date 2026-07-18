import { beforeEach, describe, expect, test } from "bun:test";
import {
  type Context,
  controller,
  createApp,
  get,
  type Guard,
  use,
} from "../src/framework";

const calls: string[] = [];
beforeEach(() => {
  calls.length = 0;
});

const guardA: Guard = () => {
  calls.push("A");
};
const guardB: Guard = () => {
  calls.push("B");
};
const block: Guard = () => {
  calls.push("block");
  return new Response("blocked", { status: 403 });
};
const throwResponse: Guard = () => {
  throw new Response("boom", { status: 401 });
};

@controller("/g")
@use(guardA) // runs before every route in this controller
class GuardedController {
  @get("/plain")
  plain(_ctx: Context) {
    calls.push("handler");
    return { ok: true };
  }

  @get("/method")
  @use(guardB) // stacks on top of the class guard
  method(_ctx: Context) {
    calls.push("handler");
    return { ok: true };
  }

  @get("/blocked")
  @use(block)
  blocked(_ctx: Context) {
    calls.push("handler");
    return { ok: true };
  }

  @get("/thrown")
  @use(throwResponse)
  thrown(_ctx: Context) {
    calls.push("handler");
    return { ok: true };
  }
}

const app = await createApp({ controllers: [GuardedController] });

describe("guards", () => {
  test("a class guard runs before the handler", async () => {
    const res = await app.handle(new Request("http://t/g/plain"));
    expect(res.status).toBe(200);
    expect(calls).toEqual(["A", "handler"]);
  });

  test("a method guard stacks after the class guard, in order", async () => {
    await app.handle(new Request("http://t/g/method"));
    expect(calls).toEqual(["A", "B", "handler"]);
  });

  test("a guard returning a Response short-circuits the handler", async () => {
    const res = await app.handle(new Request("http://t/g/blocked"));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("blocked");
    expect(calls).toEqual(["A", "block"]); // handler never ran
  });

  test("a guard throwing a Response is caught and returned", async () => {
    const res = await app.handle(new Request("http://t/g/thrown"));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("boom");
    expect(calls).toEqual(["A"]); // handler never ran
  });
});
