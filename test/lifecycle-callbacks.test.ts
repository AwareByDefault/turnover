import { describe, expect, spyOn, test } from "bun:test";
import {
  Container,
  controller,
  createApp,
  get,
  inject,
  injectable,
  postConstruct,
  preDestroy,
} from "../src/framework";

describe("@postConstruct", () => {
  test("runs after construction (fields already initialized)", () => {
    class Service {
      steps: string[] = ["constructed"];
      @postConstruct
      init() {
        this.steps.push("initialized");
      }
    }
    const c = new Container();
    expect(c.resolve(Service).steps).toEqual(["constructed", "initialized"]);
  });

  test("multiple @postConstruct methods all run", () => {
    const ran: string[] = [];
    class Service {
      @postConstruct
      a() {
        ran.push("a");
      }
      @postConstruct
      b() {
        ran.push("b");
      }
    }
    new Container().resolve(Service);
    expect(ran.sort()).toEqual(["a", "b"]);
  });

  test("a sync hook that throws fails construction", () => {
    class Bad {
      @postConstruct
      init() {
        throw new Error("init failed");
      }
    }
    expect(() => new Container().resolve(Bad)).toThrow("init failed");
  });

  test("async hooks are awaited by container.init()", async () => {
    class Resource {
      ready = false;
      @postConstruct
      async connect() {
        await Promise.resolve();
        this.ready = true;
      }
    }
    const c = new Container();
    const r = c.resolve(Resource);
    expect(r.ready).toBe(false); // resolve() is sync — not awaited yet
    await c.init();
    expect(r.ready).toBe(true);
  });
});

describe("@preDestroy", () => {
  test("runs on container.dispose()", async () => {
    const closed: string[] = [];
    class Service {
      @preDestroy
      close() {
        closed.push("closed");
      }
    }
    const c = new Container();
    c.resolve(Service);
    await c.dispose();
    expect(closed).toEqual(["closed"]);
  });

  test("beans are disposed in reverse construction order (LIFO)", async () => {
    const order: string[] = [];
    class A {
      @preDestroy
      close() {
        order.push("A");
      }
    }
    class B {
      @preDestroy
      close() {
        order.push("B");
      }
    }
    const c = new Container();
    c.resolve(A);
    c.resolve(B);
    await c.dispose();
    expect(order).toEqual(["B", "A"]);
  });

  test("a failing hook is logged and doesn't stop the others", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    const closed: string[] = [];
    class A {
      @preDestroy
      close() {
        closed.push("A");
      }
    }
    class B {
      @preDestroy
      close() {
        throw new Error("boom");
      }
    }
    const c = new Container();
    c.resolve(A);
    c.resolve(B);
    await c.dispose();
    expect(closed).toEqual(["A"]); // A still ran after B threw
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("dispose is safe when nothing is registered", async () => {
    await new Container().dispose();
    expect(true).toBe(true);
  });
});

describe("app integration", () => {
  test("createApp awaits async @postConstruct; app.stop() runs @preDestroy", async () => {
    @injectable()
    class DbPool {
      connected = false;
      @postConstruct
      async connect() {
        await Promise.resolve();
        this.connected = true;
      }
      @preDestroy
      async close() {
        this.connected = false;
      }
    }

    @controller("/db")
    class DbController {
      private readonly pool = inject(DbPool);
      @get("/")
      status() {
        return { connected: this.pool.connected };
      }
    }

    const app = await createApp({ controllers: [DbController] });

    // postConstruct was awaited during createApp → connected before serving.
    const res = await app.handle(new Request("http://t/db"));
    expect(await res.json()).toEqual({ connected: true });

    const pool = app.container.resolve(DbPool);
    expect(pool.connected).toBe(true);
    await app.stop();
    expect(pool.connected).toBe(false); // preDestroy ran
  });
});
