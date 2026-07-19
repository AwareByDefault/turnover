// Generate a typed TypeScript client from an OpenAPI document (e.g. the one
// `app.openapi()` produces). Available at the `turnover/codegen` subpath; run it
// at build time and commit or bundle the output.
//
// CLI wrapper (four lines):
//   const doc = await Bun.file(process.argv[2]).json()
//   await Bun.write(process.argv[3], generateClient(doc))

import type { OpenApiDocument } from './openapi'

/** Options for {@link generateClient}. */
export interface GenerateClientOptions {
  /** Name of the generated factory function (default `"createClient"`). */
  clientName?: string
}

type Schema = Record<string, unknown>

/** Map a (JSON Schema) node to a TypeScript type expression. */
function tsType(schema: unknown): string {
  if (!schema || typeof schema !== 'object') return 'unknown'
  const node = schema as Schema

  if (Array.isArray(node.enum)) {
    return (
      node.enum.map((value) => JSON.stringify(value)).join(' | ') || 'never'
    )
  }
  if (node.const !== undefined) return JSON.stringify(node.const)
  if (Array.isArray(node.anyOf)) return unionOf(node.anyOf)
  if (Array.isArray(node.oneOf)) return unionOf(node.oneOf)

  const type = node.type
  if (Array.isArray(type)) {
    // OpenAPI 3.1 nullable style: `type: ["string", "null"]`.
    return type.map((t) => tsType({ ...node, type: t })).join(' | ')
  }

  switch (type) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'array':
      return `Array<${tsType(node.items)}>`
    case 'object':
      return objectType(node)
    default:
      return node.properties ? objectType(node) : 'unknown'
  }
}

function unionOf(schemas: unknown[]): string {
  const parts = schemas.map(tsType)
  return parts.length > 0 ? parts.join(' | ') : 'unknown'
}

function objectType(node: Schema): string {
  const properties = (node.properties ?? {}) as Record<string, unknown>
  const required = new Set((node.required as string[] | undefined) ?? [])
  const entries = Object.entries(properties)
  if (entries.length === 0) return 'Record<string, unknown>'
  const fields = entries.map(([key, value]) => {
    const optional = required.has(key) ? '' : '?'
    return `${JSON.stringify(key)}${optional}: ${tsType(value)}`
  })
  return `{ ${fields.join('; ')} }`
}

interface Parameter {
  name: string
  in: string
  required?: boolean
  schema?: unknown
}

interface Operation {
  operationId?: string
  parameters?: Parameter[]
  requestBody?: { content?: Record<string, { schema?: unknown }> }
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>
}

const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'patch',
  'head',
  'options',
]

function objectFromParams(params: Parameter[]): string {
  const fields = params.map((param) => {
    const optional = param.required ? '' : '?'
    return `${JSON.stringify(param.name)}${optional}: ${tsType(param.schema ?? { type: 'string' })}`
  })
  return `{ ${fields.join('; ')} }`
}

function responseType(operation: Operation): string {
  const ok =
    operation.responses?.['200'] ??
    operation.responses?.['201'] ??
    operation.responses?.default
  const schema = ok?.content?.['application/json']?.schema
  return schema ? tsType(schema) : 'unknown'
}

/** Turn `/users/{id}` into a template literal reading from `req.params`. */
function pathTemplate(path: string): string {
  const replaced = path.replace(
    /\{([^}]+)\}/g,
    (_, name) =>
      `\${encodeURIComponent(String(req.params[${JSON.stringify(name)}]))}`,
  )
  return `\`${replaced}\``
}

/**
 * Generate a self-contained, dependency-free typed client module (TypeScript
 * source) from an OpenAPI document. Each operation becomes a method typed from
 * its path/query parameters, request body, and 2xx response schema; the client
 * builds the URL, query string, and JSON body and calls an injectable `fetch`.
 *
 * ```ts
 * const source = generateClient(app.openapi({ info: { title: 'API', version: '1' } }))
 * await Bun.write('client.ts', source)
 * ```
 */
export function generateClient(
  doc: OpenApiDocument,
  options: GenerateClientOptions = {},
): string {
  const clientName = options.clientName ?? 'createClient'
  const methods: string[] = []

  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = (item as Record<string, unknown>)[method] as
        | Operation
        | undefined
      if (!operation) continue

      const opId = operation.operationId ?? `${method}${path}`
      const params = operation.parameters ?? []
      const pathParams = params.filter((p) => p.in === 'path')
      const queryParams = params.filter((p) => p.in === 'query')
      const bodySchema =
        operation.requestBody?.content?.['application/json']?.schema

      const reqFields: string[] = []
      if (pathParams.length > 0) {
        reqFields.push(`params: ${objectFromParams(pathParams)}`)
      }
      if (queryParams.length > 0) {
        reqFields.push(`query?: ${objectFromParams(queryParams)}`)
      }
      if (bodySchema) reqFields.push(`body: ${tsType(bodySchema)}`)

      const hasRequired = pathParams.length > 0 || bodySchema !== undefined
      let reqParam = ''
      let reqArg = '{}'
      if (reqFields.length > 0) {
        const reqType = `{ ${reqFields.join('; ')} }`
        // Optional-only requests (e.g. just a query) default to `{}` so the
        // caller may omit the argument entirely.
        reqParam = hasRequired ? `req: ${reqType}` : `req: ${reqType} = {}`
        reqArg = 'req'
      }

      methods.push(
        `    async ${opId}(${reqParam}): Promise<${responseType(operation)}> {\n` +
          `      const res = await request(${JSON.stringify(method.toUpperCase())}, ${pathTemplate(path)}, ${reqArg})\n` +
          `      return res.json() as Promise<${responseType(operation)}>\n` +
          `    },`,
      )
    }
  }

  return `${HEADER}

export function ${clientName}(options: ClientOptions = {}) {
  const baseUrl = options.baseUrl ?? ''
  const doFetch = options.fetch ?? fetch
  async function request(method: string, path: string, req: AnyReq): Promise<Response> {
    const query = new URLSearchParams()
    if (req.query) {
      for (const [key, value] of Object.entries(req.query)) {
        if (value !== undefined && value !== null) query.set(key, String(value))
      }
    }
    const qs = query.toString()
    const headers: Record<string, string> = { ...options.headers }
    const init: RequestInit = { method, headers }
    if (req.body !== undefined) {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(req.body)
    }
    return doFetch(baseUrl + path + (qs ? '?' + qs : ''), init)
  }
  return {
${methods.join('\n')}
  }
}
`
}

const HEADER = `// Generated by turnover/codegen — do not edit by hand.

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface ClientOptions {
  /** Prepended to every request path. */
  baseUrl?: string
  /** Headers sent on every request. */
  headers?: Record<string, string>
  /** Injected fetch (default the global). */
  fetch?: FetchLike
}

interface AnyReq {
  params?: Record<string, unknown>
  query?: Record<string, unknown>
  body?: unknown
}`
