---
title: Scheduled tasks
description: Run a service method on a fixed interval while your app is listening with @scheduled.
sidebar:
  order: 16
---

`@scheduled` runs a service method on a **fixed interval** for as long as the app is
listening. Use it for recurring background work — sweeping expired records, refreshing a
cache, sending reminders.

## A scheduled method

Decorate an injectable method with an interval in milliseconds:

```ts title="reminders.ts"
import { injectable, scheduled } from "turnover";

@injectable()
class Reminders {
  @scheduled({ interval: 60_000 })
  async sweep() {
    // runs every 60 seconds while the app is listening
  }
}
```

```ts title="server.ts"
import { createApp } from "turnover";

const app = await createApp({
  controllers: [/* ... */],
  listeners: [Reminders], // construct it so its task registers
});
app.listen(3000); // scheduled tasks start running now
```

## When tasks run

The scheduler is tied to the server's lifecycle: it is **started by `app.listen()` and
stopped by `app.stop()`**. Nothing fires before you listen, and everything stops on a clean
shutdown.

- `interval` is the number of **milliseconds** between the *starts* of consecutive
  runs — a fixed `setInterval` period, not stretched to account for how long a run takes.
- `runOnStart: true` also runs the method **once immediately at startup**, before the first
  interval elapses:

```ts
@scheduled({ interval: 60_000, runOnStart: true })
async sweep() {
  // runs once when the app starts listening, then every 60 seconds
}
```

A run that throws (or rejects) is **logged, not propagated** — one failed run never stops
the schedule or crashes the app; the next interval fires as usual.

## Register the service

Like an event listener, a `@scheduled` method's task registers **when its service is
constructed**. If nothing injects the service, list it under `listeners` so `createApp`
builds it at boot:

```ts
const app = await createApp({ listeners: [Reminders] });
```

If another provider already injects the service, it is constructed anyway and you don't
need to list it.

:::caution
Runs are **not serialized**. The interval fires on a fixed timer regardless of whether the
previous run has finished, so a task that sometimes takes longer than its `interval` can
overlap with the next run. Keep scheduled work well under its interval, or guard against
re-entrancy yourself.
:::

:::note
Each running instance of your app schedules its own tasks in-process. There is no built-in
cron-expression syntax and no cross-process coordination — for cron schedules (or to ensure
a job runs once across many instances), layer an external cron library over the same
methods.
:::

## Next steps

- [Events](/concepts/events/) — the other post-construction hook, triggered by a published event instead of a timer.
- [Dependency injection](/concepts/dependency-injection/) — how the scheduled service is constructed and why `listeners` exists.
- [Lifecycle hooks and plugins](/concepts/lifecycle-hooks-and-plugins/) — the `listen()`/`stop()` lifecycle the scheduler rides on.
