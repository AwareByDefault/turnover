import { getRequestState, type Guard, setPrincipal } from "../framework";

// Describe this app's user by augmenting the framework's Principal interface.
// After this, `Auth.user` is typed as `{ id; name; roles }` everywhere.
declare module "../framework/auth" {
  interface Principal {
    id: string;
    name: string;
    roles: string[];
  }
}

// Toy token -> user table. A real app would verify a JWT / session here.
const USERS: Record<string, { id: string; name: string; roles: string[] }> = {
  "alice-token": { id: "1", name: "Alice", roles: ["admin"] },
  "bob-token": { id: "2", name: "Bob", roles: ["user"] },
};

/** Authenticate via `Authorization: Bearer <token>`; 401 on a bad/missing token. */
export const authenticate: Guard = (ctx) => {
  const token = ctx.req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const user = token ? USERS[token] : undefined;
  if (!user) {
    return new Response("Unauthorized: bad or missing token", { status: 401 });
  }
  setPrincipal(user);
};

/** Guard factory: require the authenticated user to have a given role (403 if not). */
export const requireRole =
  (role: string): Guard =>
  () => {
    const user = getRequestState()?.principal;
    if (!user?.roles.includes(role)) {
      return new Response(`Forbidden: requires role "${role}"`, { status: 403 });
    }
  };
