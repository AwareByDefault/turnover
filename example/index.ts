import { createApp } from 'turnover'

// Controllers are auto-discovered: createApp() scans the source tree for
// `@controller` classes, so no imports of individual controllers are needed here.
const app = await createApp()
const server = app.listen(3000)

console.log(`🚀 Server running at ${server.url}`)
console.log('📍 Routes:', app.routeTable())
