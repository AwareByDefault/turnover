// Fixture spawned by runtime.test.ts as a real server process. It reads PORT
// from the environment (via app.listen with no argument) and installs the
// default graceful-shutdown signal handlers.
import { controller, createApp, get } from '../../src'

@controller('')
class Ping {
  @get('/ping')
  ping() {
    return { ok: true }
  }
}

const app = await createApp({
  controllers: [Ping],
  onStop: [() => console.log('STOPPED')],
})
const server = app.listen()
console.log(`READY port=${server.port}`)
