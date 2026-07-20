---
title: Events
description: Decouple your code with an in-process publish/subscribe bus — inject Events, publish event objects, and subscribe with @onEvent.
sidebar:
  order: 15
---

`Events` is an **in-process publish/subscribe bus** for decoupling. A handler publishes an
event object without knowing who reacts to it; subscribers listen for a specific event
class and run when one is published. Both live in the same process — no broker, no
serialization.

## Publish and subscribe

Define an event as a plain class, subscribe a service method with `@onEvent`, and publish
from anywhere that can inject `Events`:

```ts title="users.ts"
import { injectable, controller, post, inject, onEvent, Events, type Context } from "turnover";

class UserCreated {
  constructor(readonly id: string) {}
}

@injectable()
class Emailer {
  @onEvent(UserCreated)
  async welcome(e: UserCreated) {
    await sendWelcomeEmail(e.id);
  }
}

@controller("/users")
class UsersController {
  private events = inject(Events);

  @post("/")
  async create(ctx: Context) {
    const user = await save(await ctx.body());
    await this.events.publish(new UserCreated(user.id)); // fan out to listeners
    return user;
  }
}
```

Publishing a `UserCreated` runs every method subscribed to that event class. The event's
runtime class is what routes it — `publish` looks up listeners by `event.constructor`.
Matching is by **exact class**: a listener registered on a base class does *not* receive
published subclass instances (and vice versa), so subscribe to the concrete class you
publish.

## publish awaits every listener

`await events.publish(event)` resolves only once **all** listeners have finished, and it
runs them concurrently. A listener that throws (or rejects) is **logged, not propagated** —
one failing listener never fails `publish` or the other listeners:

```ts
await this.events.publish(new UserCreated(user.id));
// resolves after all listeners settle; a thrown/rejected listener is logged to console
```

:::caution
Because a failing listener is swallowed (logged, not thrown), `publish` is fire-and-forget
for correctness: it tells you nothing about whether the work succeeded. Don't put
must-succeed steps behind an event. Events are also in-process only — listeners run in the
same process and nothing survives a restart. For work that must be durable or retried, use
a background queue instead.
:::

## Listeners must be constructed to subscribe

A `@onEvent` method subscribes to the bus **when its service is constructed** — not when
the class is defined. If nothing injects the listener service, it is never constructed and
its subscription never happens.

List such services under `listeners` so `createApp` constructs them at boot:

```ts title="server.ts"
import { createApp } from "turnover";

const app = await createApp({
  controllers: [UsersController],
  listeners: [Emailer], // construct Emailer eagerly so @onEvent subscribes
});
```

If another provider already injects `Emailer`, it is constructed anyway and you don't need
to list it — `listeners` is only for services that nothing else would build.

## Subscribing programmatically

The decorator is a convenience over `Events.on(type, listener)`, which subscribes a
function directly and returns an unsubscribe function:

```ts
const off = events.on(UserCreated, (e) => console.log("created", e.id));
// later:
off(); // stop listening
```

## Next steps

- [Dependency injection](/concepts/dependency-injection/) — how `Events` and your listener services are constructed and wired.
- [Scheduled tasks](/concepts/scheduled-tasks/) — the other post-construction subscription, run on a timer instead of an event.
