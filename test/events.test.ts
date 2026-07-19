import { describe, expect, spyOn, test } from 'bun:test'
import {
  type Context,
  controller,
  createApp,
  Events,
  get,
  inject,
  injectable,
  onEvent,
} from '../src'

class UserCreated {
  constructor(readonly id: string) {}
}
class OrderPlaced {
  constructor(readonly total: number) {}
}

describe('Events bus', () => {
  test('on() + publish() delivers to subscribers', async () => {
    const bus = new Events()
    const seen: string[] = []
    bus.on(UserCreated, (e) => seen.push(e.id))
    await bus.publish(new UserCreated('1'))
    expect(seen).toEqual(['1'])
  })

  test('publish awaits async listeners', async () => {
    const bus = new Events()
    const seen: string[] = []
    bus.on(UserCreated, async (e) => {
      await Promise.resolve()
      seen.push(e.id)
    })
    await bus.publish(new UserCreated('2'))
    expect(seen).toEqual(['2']) // already resolved because publish awaited
  })

  test("only subscribers of the event's class are called", async () => {
    const bus = new Events()
    const seen: string[] = []
    bus.on(UserCreated, () => seen.push('user'))
    bus.on(OrderPlaced, () => seen.push('order'))
    await bus.publish(new OrderPlaced(10))
    expect(seen).toEqual(['order'])
  })

  test('unsubscribe stops delivery', async () => {
    const bus = new Events()
    const seen: string[] = []
    const off = bus.on(UserCreated, () => seen.push('x'))
    off()
    await bus.publish(new UserCreated('3'))
    expect(seen).toEqual([])
  })

  test('a failing listener is logged; others still run', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    const bus = new Events()
    const seen: string[] = []
    bus.on(UserCreated, () => {
      throw new Error('boom')
    })
    bus.on(UserCreated, () => seen.push('ok'))
    await bus.publish(new UserCreated('4'))
    expect(seen).toEqual(['ok'])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('@onEvent + DI', () => {
  test("createApp({ listeners }) subscribes a service's @onEvent methods", async () => {
    @injectable()
    class Emailer {
      sent: string[] = []
      @onEvent(UserCreated)
      welcome(e: UserCreated) {
        this.sent.push(e.id)
      }
    }
    const app = await createApp({ controllers: [], listeners: [Emailer] })
    await app.container.resolve(Events).publish(new UserCreated('42'))
    expect(app.container.resolve(Emailer).sent).toEqual(['42'])
  })

  test('a controller can publish to a listener service', async () => {
    class Pinged {
      constructor(readonly msg: string) {}
    }
    @injectable()
    class PingLog {
      entries: string[] = []
      @onEvent(Pinged)
      record(e: Pinged) {
        this.entries.push(e.msg)
      }
    }
    @controller('/ping')
    class PingController {
      private readonly events = inject(Events)
      @get('/')
      async ping(_ctx: Context) {
        await this.events.publish(new Pinged('hello'))
        return { ok: true }
      }
    }
    const app = await createApp({
      controllers: [PingController],
      listeners: [PingLog],
    })
    await app.handle(new Request('http://t/ping'))
    expect(app.container.resolve(PingLog).entries).toEqual(['hello'])
  })
})
