import type { Deriver, ErrorHandler, Guard, Interceptor } from './http'
import { CLASS_MACROS, ctxMeta, METHOD_MACROS } from './metadata'

/**
 * The cross-cutting a macro contributes to a route: a bundle of the same hooks
 * `@use` / `@derive` / `@intercept` / `@catchError` attach.
 */
export interface MacroHooks {
  use?: Guard[]
  derive?: Deriver[]
  intercept?: Interceptor[]
  catchError?: ErrorHandler[]
}

/**
 * Builds a macro's hooks from its arguments. Invoked in an injection context at
 * mount time, so it may `inject()` services and close over them in the hooks.
 */
export type MacroFactory = (...args: any[]) => MacroHooks

/** One application of a macro on a controller/route: its name and arguments. */
export interface MacroApplication {
  name: string
  args: unknown[]
}

const registry = new Map<string, MacroFactory>()

/**
 * Register a named, parameterized bundle of cross-cutting hooks. Apply it to a
 * controller or route with `@macro(name, ...args)`.
 *
 * ```ts
 * defineMacro("role", (required: string) => {
 *   const auth = inject(Auth);
 *   return { use: [() => auth.user.roles.includes(required) ? undefined
 *                     : new Response("Forbidden", { status: 403 })] };
 * });
 * ```
 */
export function defineMacro(name: string, factory: MacroFactory): void {
  registry.set(name, factory)
}

/** Apply a registered macro (by name, with args) to a controller or route. */
export function macro(name: string, ...args: unknown[]) {
  return (
    _value: unknown,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ): void => {
    const meta = ctxMeta(context)
    if (context.kind === 'class') {
      const list = (meta[CLASS_MACROS] as MacroApplication[] | undefined) ?? []
      list.push({ name, args })
      meta[CLASS_MACROS] = list
    } else {
      const map =
        (meta[METHOD_MACROS] as
          | Map<PropertyKey, MacroApplication[]>
          | undefined) ?? new Map<PropertyKey, MacroApplication[]>()
      const list = map.get(context.name) ?? []
      list.push({ name, args })
      map.set(context.name, list)
      meta[METHOD_MACROS] = map
    }
  }
}

/**
 * Expand macro applications into merged hooks. Call inside `container.runInContext`
 * so factories can `inject()`. Throws if a macro name is not registered.
 */
export function expandMacros(
  applications: readonly MacroApplication[],
): Required<MacroHooks> {
  const merged: Required<MacroHooks> = {
    use: [],
    derive: [],
    intercept: [],
    catchError: [],
  }
  for (const application of applications) {
    const factory = registry.get(application.name)
    if (!factory) {
      throw new Error(
        `Unknown macro "${application.name}". Register it with defineMacro(...).`,
      )
    }
    const hooks = factory(...application.args)
    if (hooks.use) merged.use.push(...hooks.use)
    if (hooks.derive) merged.derive.push(...hooks.derive)
    if (hooks.intercept) merged.intercept.push(...hooks.intercept)
    if (hooks.catchError) merged.catchError.push(...hooks.catchError)
  }
  return merged
}
