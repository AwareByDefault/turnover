---
title: Responses & cookies
description: Shape a response without building one by hand — set status and headers through ctx.set, and read or queue cookies through ctx.cookies.
sidebar:
  order: 9
---

Return a value and Turnover coerces it into a response. When you need to set a status code,
add headers, or work with cookies, do it through `ctx.set` and `ctx.cookies` — no
hand-built `Response` required.

## Set status and headers with `ctx.set`

```ts title="session.controller.ts"
import { controller, post, type Context } from "turnover";

@controller("/session")
export class SessionController {
  @post("/login")
  login(ctx: Context) {
    ctx.set.status = 201; // status for the coerced body
    ctx.set.headers.set("cache-control", "no-store");
    return { ok: true }; // => 201, cache-control: no-store, { "ok": true }
  }
}
```

- **`ctx.set.status`** sets the status for a **coerced** return value (a plain object,
  string, `null`, etc.). A handler that returns a `Response` directly keeps *that* response's
  own status — `ctx.set.status` is ignored for it.
- **`ctx.set.headers`** is a `Headers` object. Whatever you put on it is **merged onto the
  outgoing response** — including a returned `Response`, whose own headers are preserved.

## Read and write cookies with `ctx.cookies`

`ctx.cookies` reads the incoming `Cookie` header and queues outgoing `Set-Cookie`s.

```ts title="session.controller.ts"
@controller("/session")
export class SessionController {
  @post("/login")
  login(ctx: Context) {
    ctx.cookies.set("session", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 3600,
    });
    return { ok: true };
  }

  @get("/me")
  me(ctx: Context) {
    const sid = ctx.cookies.get("session"); // read an incoming cookie
    return { hasSession: ctx.cookies.has("session"), sid };
  }

  @post("/logout")
  logout(ctx: Context) {
    ctx.cookies.delete("session"); // expire it
    return null; // => 204, still carries the Set-Cookie that clears the cookie
  }
}
```

**Reading incoming cookies:**

- `ctx.cookies.get(name)` — the value, or `undefined`.
- `ctx.cookies.has(name)` — whether it's present.
- `ctx.cookies.all()` — every incoming cookie as a plain object.

**Queueing outgoing cookies:**

- `ctx.cookies.set(name, value, options?)` — queue a `Set-Cookie`.
- `ctx.cookies.delete(name, options?)` — queue a `Set-Cookie` that expires the cookie.

Cookie values are URL-encoded on the way out and decoded on the way in.

### Cookie options

`set()` accepts a `CookieOptions`:

| Option | Effect |
|---|---|
| `httpOnly` | Hide from client-side JavaScript. |
| `secure` | Only send over HTTPS. |
| `sameSite` | `"strict"` \| `"lax"` \| `"none"` — CSRF control. |
| `maxAge` | Lifetime in seconds. |
| `expires` | Absolute expiry (`Date`). |
| `path` | Path scope (default `"/"`). |
| `domain` | Restrict to a domain. |
| `partitioned` | Opt into partitioned (CHIPS) storage. |

## They apply to every response

`ctx.set.headers` and queued cookies are merged onto **every** response the request produces
— not just the one your handler returns. That includes a **guard's short-circuit**: if a
deriver or guard set a header or queued a cookie and then a guard rejected the request with a
`401`, that header and `Set-Cookie` still ride along on the `401`.

:::note
Because headers and cookies are applied at the very end of the pipeline, a `Response` you
build by hand is not the final word — `ctx.set.headers` still merges onto it, and queued
cookies are still appended.
:::

## Next steps

- [Controllers & routing](/concepts/controllers-and-routing/) — how return values are
  coerced into responses.
- [Guards & auth](/concepts/guards-and-auth/) — short-circuit responses that still carry
  your headers and cookies.
