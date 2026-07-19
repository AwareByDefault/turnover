// Build-time support for auto-discovery, exposed as the `turnover/bundler`
// subpath. Auto-discovery relies on a runtime filesystem scan, which a bundler
// tree-shakes away (nothing statically imports the controllers). This plugin
// runs the *same* scan at BUILD time and injects a static side-effect import of
// each `@controller` file into the entrypoint — so the bundler includes them,
// they self-register on load, and `createApp()` mounts them from the registry.
// The result: auto-discovery that survives `bun build`, with no source changes.

import { dirname, isAbsolute, resolve } from 'node:path'
import type { BunPlugin } from 'bun'

const CONTROLLER = /@controller\s*\(/

/** Absolute paths of every `.ts` file under `dir` whose source declares a `@controller`. */
export async function scanControllerFiles(dir: string): Promise<string[]> {
  const glob = new Bun.Glob('**/*.ts')
  const files: string[] = []
  for await (const rel of glob.scan({ cwd: dir })) {
    const abs = `${dir}/${rel}`
    if (CONTROLLER.test(await Bun.file(abs).text())) files.push(abs)
  }
  return files.sort()
}

function loaderFor(path: string): 'ts' | 'tsx' | 'js' | 'jsx' {
  if (path.endsWith('.tsx')) return 'tsx'
  if (path.endsWith('.jsx')) return 'jsx'
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'js'
  return 'ts'
}

/** Options for {@link turnoverPlugin}. */
export interface TurnoverPluginOptions {
  /** Directory to scan for controllers (default: the first entrypoint's directory). */
  dir?: string
}

/**
 * A `Bun.build` plugin that makes auto-discovery survive bundling:
 *
 * ```ts
 * import { turnoverPlugin } from "turnover/bundler";
 *
 * await Bun.build({
 *   entrypoints: ["./src/server.ts"],
 *   outdir: "./dist",
 *   target: "bun",
 *   plugins: [turnoverPlugin()],
 * });
 * ```
 *
 * It scans for `@controller` files at build time and injects a static import of
 * each into the entrypoint(s), so they're bundled and self-register — the same
 * set the runtime scan would have found. Your entry keeps calling `createApp()`
 * with no arguments; nothing in the app changes.
 */
export function turnoverPlugin(options: TurnoverPluginOptions = {}): BunPlugin {
  return {
    name: 'turnover:discover',
    // NOTE: register hooks synchronously — an `await` before them would register
    // too late to fire. The scan runs lazily (and memoized) inside the hooks.
    setup(build) {
      const entrypoints = build.config.entrypoints ?? []
      const first = entrypoints[0]
      if (first === undefined) return
      const dir = options.dir ?? dirname(resolve(first))
      const entries = new Set(entrypoints.map((entry) => resolve(entry)))

      let scan: Promise<string[]> | undefined
      const controllers = () => (scan ??= scanControllerFiles(dir))

      // A `@controller` file self-registers on load, but the bare imports we
      // inject below have no used bindings — so mark those modules
      // side-effectful, or tree-shaking (the package is `sideEffects`-scoped)
      // would drop them.
      build.onResolve({ filter: /\.[jt]sx?$/ }, async (args) => {
        const abs = isAbsolute(args.path)
          ? args.path
          : resolve(dirname(args.importer), args.path)
        return (await controllers()).includes(abs)
          ? { path: abs, sideEffects: true }
          : undefined
      })

      // Inject a side-effect import of every discovered controller into the
      // entrypoint(s), so the bundler includes them (and they self-register).
      build.onLoad({ filter: /\.[jt]sx?$/ }, async (args) => {
        if (!entries.has(args.path)) return undefined
        const prefix = (await controllers())
          .map((path) => `import ${JSON.stringify(path)}`)
          .join('\n')
        const source = await Bun.file(args.path).text()
        return {
          contents: prefix ? `${prefix}\n${source}` : source,
          loader: loaderFor(args.path),
        }
      })
    },
  }
}
