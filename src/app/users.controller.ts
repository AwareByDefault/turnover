import { type Context, controller, del, get, inject, post } from "../framework";
import { GreetingService } from "./greeting.service";

interface User {
  id: string;
  name: string;
}

@controller("/users")
export class UsersController {
  // Dependency injection: resolved from the container when this controller is
  // constructed. No constructor and no parameter decorators needed.
  private readonly greeter = inject(GreetingService);
  private readonly users = new Map<string, User>();

  @get("/")
  list() {
    return { users: [...this.users.values()] };
  }

  @get("/:id")
  getOne(ctx: Context<{ id: string }>) {
    const user = this.users.get(ctx.params.id);
    if (!user) return new Response(`No user "${ctx.params.id}"`, { status: 404 });
    return { user, greeting: this.greeter.greet(user.name) };
  }

  @post("/")
  async create(ctx: Context) {
    const user = await ctx.body<User>();
    this.users.set(user.id, user);
    return Response.json(
      { created: user, greeting: this.greeter.greet(user.name) },
      { status: 201 }
    );
  }

  @del("/:id")
  remove(ctx: Context<{ id: string }>) {
    return { deleted: this.users.delete(ctx.params.id) };
  }
}
