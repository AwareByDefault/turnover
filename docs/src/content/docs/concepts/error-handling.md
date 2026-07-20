---
title: Error handling
description: Throw HttpError (or a named subclass) for clean HTTP responses, understand how unknown errors become opaque 500s, and customize rendering with the @catchError chain or the problemDetails() plugin.
sidebar:
  order: 7
---

Throw an `HttpError` from a handler or guard and Turnover renders it as a JSON response with
the right status. Anything that isn't an `HttpError` becomes an opaque `500`.

## Throw an `HttpError`

```ts title="users.controller.ts"
import { controller, get, NotFoundError, type Context } from "turnover";

@controller("/users")
export class UsersController {
  @get("/:id")
  getOne(ctx: Context<{ id: string }>) {
    const user = this.users.get(ctx.params.id);
    if (!user) throw new NotFoundError(`No user "${ctx.params.id}"`);
    return { user };
  }
}
```

A `GET /users/999` for a missing user produces:

```json
// 404
{ "error": { "message": "No user \"999\"" } }
```

## Named subclasses

Each named subclass carries a fixed status and a default message. Pass a message to override
it:

| Class | Status |
|---|---|
| `BadRequestError` | 400 |
| `UnauthorizedError` | 401 |
| `PaymentRequiredError` | 402 |
| `ForbiddenError` | 403 |
| `NotFoundError` | 404 |
| `ConflictError` | 409 |
| `GoneError` | 410 |
| `UnprocessableEntityError` | 422 |
| `TooManyRequestsError` | 429 |
| `InternalServerError` | 500 |

For any other status, or to attach a machine-readable `code` and structured `details`,
construct `HttpError` directly:

```ts title="billing.controller.ts"
import { HttpError } from "turnover";

throw new HttpError(402, "Trial expired", {
  code: "trial_expired",
  details: { upgradeUrl: "/pricing" },
});
```

The rendered envelope includes `message`, and `code` / `details` when present:

```json
// 402
{
  "error": {
    "message": "Trial expired",
    "code": "trial_expired",
    "details": { "upgradeUrl": "/pricing" }
  }
}
```

:::note
There is **no fixed set of error codes** to choose from. `code` is a free-form string you
define for your own domain. The only code the framework itself emits is `validation_failed`
(a `422` from [input validation](/concepts/validation/)).
:::

Extend `HttpError` for reusable domain errors:

```ts title="errors.ts"
import { HttpError } from "turnover";

export class InsufficientFunds extends HttpError {
  constructor(balance: number) {
    super(402, "Insufficient funds", { code: "insufficient_funds", details: { balance } });
  }
}
```

## Unknown errors and thrown `Response`s

Two rules govern everything you throw that isn't an `HttpError`:

- **Anything that isn't an `HttpError`** (a `TypeError`, a database error, a plain string)
  becomes an opaque `500`. Its message is **never leaked** to the client — the response is a
  generic `Internal Server Error` — and the real error is logged server-side.
- **A thrown `Response`** passes through unchanged. This is intentional: it's how
  short-circuiting works — for example `inject(Auth).user` throws a `401` `Response` when the
  request isn't authenticated.

```ts
throw new Error("connection refused"); // => 500 { "error": { "message": "Internal Server Error" } }, real message logged
throw new Response("Teapot", { status: 418 }); // => 418, passes through untouched
```

## Customize rendering with `@catchError`

An `ErrorHandler` maps a thrown value to a `Response`, or returns nothing to defer. Attach
handlers to a route or controller with `@catchError`, and/or register a global one via
`createApp({ onError })` or `app.onError(...)`.

```ts title="orders.controller.ts"
import { catchError, controller, get, type ErrorHandler } from "turnover";

const handleDomain: ErrorHandler = (err) => {
  if (err instanceof MyDomainError) {
    return Response.json({ oops: err.message }, { status: 400 });
  }
  // return nothing → defer to the next handler in the chain
};

@controller("/orders")
@catchError(handleDomain)
export class OrdersController {
  @get("/:id")
  @catchError((err) => (err instanceof RateLimited ? new Response(null, { status: 429 }) : undefined))
  getOne() {
    /* ... */
  }
}
```

Handlers run **most-specific first**, each getting a chance to return a `Response`:

**route `@catchError` → controller `@catchError` → module → global (`onError`) → framework
default**

The first handler to return a `Response` wins. If a handler itself throws, that thrown value
short-circuits the chain and is rendered instead. When no handler produces a `Response`, the
framework default (`toErrorResponse`) renders it — the same logic described above: an
`HttpError` becomes its `toResponse()`, a `Response` passes through, and anything else
becomes an opaque `500`.

## RFC 9457 problem details

Prefer standardized error bodies? The `problemDetails()` plugin swaps the renderer to
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json`.

```ts title="server.ts"
import { createApp, problemDetails } from "turnover";

const app = await createApp({ plugins: [problemDetails()] });
// throw new NotFoundError("user 5")  =>  404 application/problem+json
```

An `HttpError` becomes a problem document carrying its `status`, a `title`, the message as
`detail`, the request path as `instance`, and any `code` / `details` as extension members.
An unknown error still becomes an opaque `500` whose message is never leaked. It's opt-in, so
existing error shapes are unchanged until you add it.

```json
// 404 application/problem+json
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "detail": "user 5",
  "instance": "/users/5"
}
```

## Next steps

- [Validation](/concepts/validation/) — the `422` `validation_failed` envelope in detail.
- [Guards & auth](/concepts/guards-and-auth/) — guards short-circuit by returning or
  throwing a `Response`.
- [Lifecycle hooks & plugins](/concepts/lifecycle-hooks-and-plugins/) — how `problemDetails()`
  and other plugins register their hooks.
