import { describe, expect, test } from "bun:test";
import {
  type Context,
  Container,
  controller,
  createApp,
  get,
  inject,
  injectable,
  injectAll,
  InjectionToken,
} from "../src/framework";

interface Greeter {
  greet(): string;
}
const GREETER = new InjectionToken<Greeter>("Greeter");
class Formal implements Greeter {
  greet() {
    return "Good day";
  }
}
class Casual implements Greeter {
  greet() {
    return "hey";
  }
}

describe("provider strategies", () => {
  test("useValue returns the bound value", () => {
    const c = new Container();
    const ANSWER = new InjectionToken<number>("answer");
    c.register(ANSWER, { useValue: 42 });
    expect(c.resolve(ANSWER)).toBe(42);
  });

  test("useClass binds an interface token to an impl (singleton by default)", () => {
    const c = new Container();
    c.register(GREETER, { useClass: Formal });
    const a = c.resolve(GREETER);
    expect(a.greet()).toBe("Good day");
    expect(c.resolve(GREETER)).toBe(a);
  });

  test("useClass with transient scope yields a fresh instance each resolve", () => {
    const c = new Container();
    c.register(GREETER, { useClass: Casual, scope: "transient" });
    expect(c.resolve(GREETER)).not.toBe(c.resolve(GREETER));
  });

  test("useFactory receives the container and can resolve other deps", () => {
    const c = new Container();
    const PREFIX = new InjectionToken<string>("prefix");
    c.register(PREFIX, { useValue: ">> " });
    const MSG = new InjectionToken<string>("msg");
    c.register(MSG, { useFactory: (con) => con.resolve(PREFIX) + "hi" });
    expect(c.resolve(MSG)).toBe(">> hi");
  });

  test("useFactory singletons are cached; transients are not", () => {
    const c = new Container();
    let n = 0;
    const S = new InjectionToken<number>("s");
    c.register(S, { useFactory: () => (n += 1) });
    expect(c.resolve(S)).toBe(1);
    expect(c.resolve(S)).toBe(1);

    let m = 0;
    const T = new InjectionToken<number>("t");
    c.register(T, { useFactory: () => (m += 1), scope: "transient" });
    expect(c.resolve(T)).toBe(1);
    expect(c.resolve(T)).toBe(2);
  });

  test("useExisting aliases one token to another (same instance)", () => {
    const c = new Container();
    c.register(GREETER, { useClass: Formal });
    const ALIAS = new InjectionToken<Greeter>("alias");
    c.register(ALIAS, { useExisting: GREETER });
    expect(c.resolve(ALIAS)).toBe(c.resolve(GREETER));
  });

  test("an unregistered InjectionToken throws a helpful error", () => {
    const c = new Container();
    const MISSING = new InjectionToken<string>("missing");
    expect(() => c.resolve(MISSING)).toThrow(/No provider registered for/);
  });
});

describe("overriding & multi-injection", () => {
  test("the last registration wins (mock override)", () => {
    const c = new Container();
    c.register(GREETER, { useClass: Formal });
    c.register(GREETER, { useValue: { greet: () => "mocked" } });
    expect(c.resolve(GREETER).greet()).toBe("mocked");
  });

  test("resolveAll returns every binding, in order", () => {
    const c = new Container();
    c.register(GREETER, { useClass: Formal });
    c.register(GREETER, { useClass: Casual });
    expect(c.resolveAll(GREETER).map((g) => g.greet())).toEqual(["Good day", "hey"]);
  });

  test("injectAll resolves all bindings inside a class", () => {
    const c = new Container();
    c.register(GREETER, { useValue: { greet: () => "a" } });
    c.register(GREETER, { useValue: { greet: () => "b" } });
    class Aggregator {
      readonly greeters = injectAll(GREETER);
    }
    expect(c.resolve(Aggregator).greeters.map((g) => g.greet())).toEqual(["a", "b"]);
  });
});

describe("backward compatibility & guards", () => {
  test("concrete @injectable classes still auto-construct without registration", () => {
    @injectable()
    class Service {
      ping() {
        return "pong";
      }
    }
    const c = new Container();
    expect(c.resolve(Service).ping()).toBe("pong");
    expect(c.resolve(Service)).toBe(c.resolve(Service));
  });

  test("inject/injectAll outside an injection context throw", () => {
    const TOKEN = new InjectionToken<number>("x");
    expect(() => inject(TOKEN)).toThrow(/outside an injection context/);
    expect(() => injectAll(TOKEN)).toThrow(/outside an injection context/);
  });
});

describe("createApp({ providers })", () => {
  test("a controller injects a bound token", async () => {
    interface Clock {
      now(): string;
    }
    const CLOCK = new InjectionToken<Clock>("Clock");

    @controller("/time")
    class TimeController {
      private readonly clock = inject(CLOCK);
      @get("/")
      now(_ctx: Context) {
        return { now: this.clock.now() };
      }
    }

    const app = await createApp({
      controllers: [TimeController],
      providers: [{ provide: CLOCK, useValue: { now: () => "frozen" } }],
    });
    const res = await app.handle(new Request("http://t/time"));
    expect(await res.json()).toEqual({ now: "frozen" });
  });
});
