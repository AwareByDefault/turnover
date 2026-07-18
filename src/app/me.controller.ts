import { Auth, controller, get, inject, use } from "../framework";
import { authenticate, requireRole } from "./auth";

@controller("/me")
@use(authenticate) // every route here requires a valid Bearer token
export class MeController {
  // Injected once (singleton), but reads the *current* request's principal.
  private readonly auth = inject(Auth);

  @get("/")
  whoami() {
    return this.auth.user; // auto-401 via the guard; typed as the app's Principal
  }

  @get("/roles")
  roles() {
    return { id: this.auth.user.id, roles: this.auth.user.roles };
  }

  @get("/admin")
  @use(requireRole("admin")) // method-level guard, on top of the controller's
  adminOnly() {
    return { secret: `Hello admin ${this.auth.user.name}` };
  }
}
