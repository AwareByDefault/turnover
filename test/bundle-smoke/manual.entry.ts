// Manual registration: the controller is statically imported, so it survives
// bundling. This is the supported way to build a bundled Turnover server.
import { createApp } from '../../src'
import { HelloController } from './hello.controller'

const app = await createApp({ controllers: [HelloController] })
const server = app.listen(Number(process.env.PORT ?? 0))
console.log(
  `READY port=${server.port} routes=${JSON.stringify(app.routeTable())}`,
)
