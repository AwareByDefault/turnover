import { describe, expect, test } from "bun:test";
import {
  Auth,
  type Context,
  controller,
  createApp,
  get,
  type Guard,
  inject,
  type Principal,
  requireAuth,
  setPrincipal,
  use,
} from "../src/framework";

type User = { id: string; name: string; roles: string[] };
const ALICE: User = { id: "1", name: "Alice", roles: ["admin"] };

/** Sets a principal when the request carries `authorization: good`. */
const login: Guard = (ctx) => {
  if (ctx.req.headers.get("authorization") === "good") {
    setPrincipal(ALICE as unknown as Principal);
  }
};

@controller("/me")
@use(login)
class MeController {
  private readonly auth = inject(Auth);

  @get("/")
  @use(requireAuth)
  whoami() {
    return { id: (this.auth.user as User).id, roles: (this.auth.user as User).roles };
  }

  @get("/strict")
  strict() {
    // No requireAuth guard: reading `auth.user` itself must 401 when anonymous.
    return { id: (this.auth.user as User).id };
  }

  @get("/status")
  status() {
    return { authed: this.auth.isAuthenticated, optional: this.auth.optional };
  }
}

const app = await createApp({ controllers: [MeController] });

describe("request-scoped auth", () => {
  test("a guard's principal is visible to the handler", async () => {
    const res = await app.handle(
      new Request("http://t/me", { headers: { authorization: "good" } })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "1", roles: ["admin"] });
  });

  test("requireAuth 401s when no principal was set", async () => {
    const res = await app.handle(new Request("http://t/me"));
    expect(res.status).toBe(401);
  });

  test("Auth.user throws 401 on its own when anonymous", async () => {
    const res = await app.handle(new Request("http://t/me/strict"));
    expect(res.status).toBe(401);
  });

  test("isAuthenticated / optional reflect the current request", async () => {
    const anon = await app.handle(new Request("http://t/me/status"));
    expect(await anon.json()).toEqual({ authed: false, optional: null });

    const authed = await app.handle(
      new Request("http://t/me/status", { headers: { authorization: "good" } })
    );
    expect(await authed.json()).toEqual({ authed: true, optional: ALICE });
  });

  test("each request gets its own principal (no leakage between requests)", async () => {
    // A prior authenticated request must not bleed into a later anonymous one.
    await app.handle(
      new Request("http://t/me/status", { headers: { authorization: "good" } })
    );
    const anon = await app.handle(new Request("http://t/me/status"));
    expect(await anon.json()).toEqual({ authed: false, optional: null });
  });

  test("setPrincipal outside a request throws", () => {
    expect(() => setPrincipal(ALICE as unknown as Principal)).toThrow(
      /outside a request context/
    );
  });
});
