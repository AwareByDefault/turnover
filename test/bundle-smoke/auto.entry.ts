// Auto-discovery: nothing statically imports the controller, so a bundler
// tree-shakes it out and the runtime filesystem scan finds no source files —
// the bundled server has zero routes. Use explicit controllers when bundling.
import { createApp } from '../../src'

const app = await createApp()
const server = app.listen(Number(process.env.PORT ?? 0))
console.log(
  `READY port=${server.port} routes=${JSON.stringify(app.routeTable())}`,
)
