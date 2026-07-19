import { type Context, controller, get, inject } from '../../src'
import { Greeter } from './greeter.service'

@controller('/hello')
export class HelloController {
  private readonly greeter = inject(Greeter)

  @get('/:name')
  hi(ctx: Context<{ name: string }>) {
    return { message: this.greeter.greet(ctx.params.name) }
  }
}
