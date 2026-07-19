---
"turnover": minor
---

WinterTC / runtime interop — `app.fetch` and `app.delegate()`.

The request pipeline is a standard WinterTC `(Request) => Promise<Response>` fetch handler. Two additions make Turnover deployable and composable across compliant runtimes:

- **`app.fetch`** — the bound fetch handler for the app, so `export default app` (or `export default { fetch: app.fetch }`) deploys on Cloudflare Workers, Deno Deploy, Vercel, etc. `app.listen()` remains the Bun server; `app.fetch` is the runtime-agnostic entry. Also exports the `FetchHandler` type.
- **`app.delegate(path, handler)`** — compose any other WinterTC-compliant handler (another Turnover app's `app.fetch`, or a raw function) at a path prefix. The prefix is stripped so the sub-app sees relative paths; the delegate owns its whole prefix; the longest matching prefix wins. Also available as `createApp({ delegate: { "/legacy": handler } })`.
