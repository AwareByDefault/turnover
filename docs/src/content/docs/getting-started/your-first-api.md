---
title: Your first API
description: Build a small Tasks API with a controller, an injected service, schema validation, and error handling.
sidebar:
  order: 3
---

The [Quickstart](/getting-started/quickstart/) served a single route. This tutorial builds
a small but realistic **Tasks API** that uses the pieces you'll reach for in a real app: a
controller, an injected service, request validation, and typed error handling. It's the
running example the concept pages build on.

By the end you'll have endpoints to create, list, fetch, and delete tasks.

## Set up the project

```bash
mkdir tasks-api && cd tasks-api
bun init -y
bun add turnover zod
```

We'll use [Zod](https://zod.dev) for validation, but Turnover speaks the
[Standard Schema](https://standardschema.dev) interface — Valibot, ArkType, and TypeBox
work the same way. See [Validation](/concepts/validation/).

## 1. A service to hold the data

Business logic lives in **services**, not controllers. Mark a class `@injectable()` and
Turnover's container will construct it and share a single instance (the default
`"singleton"` scope). Here it's a simple in-memory store:

```ts title="task.service.ts"
import { injectable } from "turnover";

export interface Task {
  id: string;
  title: string;
  done: boolean;
}

@injectable()
export class TaskService {
  private readonly tasks = new Map<string, Task>();

  list(): Task[] {
    return [...this.tasks.values()];
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  create(input: { title: string }): Task {
    const task: Task = { id: crypto.randomUUID(), title: input.title, done: false };
    this.tasks.set(task.id, task);
    return task;
  }

  remove(id: string): boolean {
    return this.tasks.delete(id);
  }
}
```

## 2. A controller that injects the service

Pull the service in with `inject(TaskService)` in a **field initializer** — no constructor,
no parameter decorators. Each method returns a plain value, which Turnover coerces into a
JSON response.

```ts title="tasks.controller.ts"
import { type Context, NotFoundError, controller, del, get, inject, post } from "turnover";
import { z } from "zod";
import { TaskService } from "./task.service";

const CreateTask = z.object({ title: z.string().min(1) });

@controller("/tasks")
export class TasksController {
  private readonly tasks = inject(TaskService);

  @get("/")
  list() {
    return { tasks: this.tasks.list() };
  }

  @get("/:id")
  getOne(ctx: Context<{ id: string }>) {
    const task = this.tasks.get(ctx.params.id);
    if (!task) throw new NotFoundError(`No task "${ctx.params.id}"`);
    return { task };
  }

  @post("/", { body: CreateTask })
  create(ctx: Context) {
    const input = ctx.valid.body as z.infer<typeof CreateTask>;
    const task = this.tasks.create(input);
    ctx.set.status = 201;
    return { created: task };
  }

  @del("/:id")
  remove(ctx: Context<{ id: string }>) {
    return { deleted: this.tasks.remove(ctx.params.id) };
  }
}
```

What's happening here:

- **`inject(TaskService)`** resolves the shared service instance when the controller is
  constructed. See [Dependency injection](/concepts/dependency-injection/).
- **`{ body: CreateTask }`** validates the request body *before* the handler runs. The
  validated, coerced value is on `ctx.valid.body`. Because standard decorators can't flow
  the schema type onto the handler, you `as`-cast it. See [Validation](/concepts/validation/).
- **`throw new NotFoundError(...)`** renders a `404` JSON error. Any thrown value that isn't
  an `HttpError` becomes an opaque `500`. See [Error handling](/concepts/error-handling/).
- **`ctx.set.status = 201`** sets the status of the coerced return value. See
  [Responses & cookies](/concepts/responses-and-cookies/).

## 3. Serve it

```ts title="server.ts"
import { createApp } from "turnover";

const app = await createApp(); // discovers TasksController in this directory
const server = app.listen(3000);

console.log(`up on ${server.url}`);
```

```bash
bun server.ts
```

## 4. Try it

Create a task:

```bash
curl -X POST localhost:3000/tasks \
  -H 'content-type: application/json' \
  -d '{"title":"Write the docs"}'
```

**You should see** a `201` with the created task:

```json
{ "created": { "id": "…", "title": "Write the docs", "done": false } }
```

List them:

```bash
curl localhost:3000/tasks
# { "tasks": [ { "id": "…", "title": "Write the docs", "done": false } ] }
```

Ask for a task that doesn't exist — the `NotFoundError` renders as a `404`:

```bash
curl -i localhost:3000/tasks/nope
# HTTP/1.1 404 Not Found
# { "error": { "message": "No task \"nope\"" } }
```

Send an invalid body — validation rejects it with a `422` before your handler runs:

```bash
curl -i -X POST localhost:3000/tasks -H 'content-type: application/json' -d '{}'
# HTTP/1.1 422 Unprocessable Entity
# { "error": { "code": "validation_failed", "details": { "location": "body", "issues": [ … ] } } }
```

That's a complete, validated, error-handled REST resource in three small files.

## Next steps

- [Controllers & routing](/concepts/controllers-and-routing/) — the `Context` object and
  response coercion in depth.
- [Dependency injection](/concepts/dependency-injection/) — scopes, providers, and lifecycle.
- [Guards & auth](/concepts/guards-and-auth/) — protect routes with `@use` and `Auth`.
- [Testing](/guides/testing/) — exercise this API in-memory with no open socket.
