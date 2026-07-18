import { describe, expect, spyOn, test } from "bun:test";
import {
  Container,
  createApp,
  injectable,
  repository,
  scheduled,
  Scheduler,
  schedulingProcessor,
  service,
} from "../src/framework";

describe("Scheduler", () => {
  test("runOnStart runs the task immediately on start()", () => {
    const scheduler = new Scheduler();
    let runs = 0;
    scheduler.add({ interval: 100_000, runOnStart: true, run: () => (runs += 1) });
    scheduler.start();
    expect(runs).toBe(1);
    scheduler.stop();
  });

  test("fires repeatedly on the interval", async () => {
    const scheduler = new Scheduler();
    let runs = 0;
    scheduler.add({ interval: 5, run: () => (runs += 1) });
    scheduler.start();
    await Bun.sleep(30);
    scheduler.stop();
    expect(runs).toBeGreaterThanOrEqual(2);
  });

  test("stop() prevents further runs", async () => {
    const scheduler = new Scheduler();
    let runs = 0;
    scheduler.add({ interval: 5, run: () => (runs += 1) });
    scheduler.start();
    await Bun.sleep(20);
    scheduler.stop();
    const afterStop = runs;
    await Bun.sleep(20);
    expect(runs).toBe(afterStop);
  });

  test("a failing task is logged and doesn't crash the scheduler", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    const scheduler = new Scheduler();
    scheduler.add({
      interval: 100_000,
      runOnStart: true,
      run: () => {
        throw new Error("boom");
      },
    });
    scheduler.start();
    expect(spy).toHaveBeenCalled();
    scheduler.stop();
    spy.mockRestore();
  });
});

describe("@scheduled", () => {
  test("registers a service's method with the scheduler", () => {
    const scheduler = new Scheduler();
    const container = new Container().addPostProcessor(schedulingProcessor(scheduler));
    let sweeps = 0;
    @injectable()
    class Reminders {
      @scheduled({ interval: 100_000, runOnStart: true })
      sweep() {
        sweeps += 1;
      }
    }
    container.resolve(Reminders); // construction → registers the task
    scheduler.start();
    expect(sweeps).toBe(1);
    scheduler.stop();
  });

  test("createApp starts scheduled tasks on listen()", async () => {
    let ran = false;
    @injectable()
    class Job {
      @scheduled({ interval: 100_000, runOnStart: true })
      go() {
        ran = true;
      }
    }
    const app = await createApp({ controllers: [], listeners: [Job] });
    const server = app.listen(0);
    try {
      expect(ran).toBe(true); // scheduler.start() ran the runOnStart task
      expect(server.port).toBeGreaterThan(0);
    } finally {
      await app.stop();
    }
  });
});

describe("stereotype aliases", () => {
  test("@service and @repository are injectable aliases", () => {
    @service()
    class Greeter {
      hi() {
        return "hi";
      }
    }
    @repository({ scope: "transient" })
    class Store {}

    const c = new Container();
    expect(c.resolve(Greeter).hi()).toBe("hi");
    expect(c.resolve(Greeter)).toBe(c.resolve(Greeter)); // singleton default
    expect(c.resolve(Store)).not.toBe(c.resolve(Store)); // transient
  });
});
