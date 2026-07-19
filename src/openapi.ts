import type { RouteSchemas, StandardSchemaV1 } from './schema'

/** OpenAPI metadata a route can declare (via its decorator options). */
export interface OperationMeta {
  summary?: string
  description?: string
  tags?: string[]
  operationId?: string
  deprecated?: boolean
}

/** One mounted route, captured for OpenAPI generation. */
export interface OperationRecord {
  method: string
  /** The normalized route pattern, e.g. `/users/:id`. */
  pattern: string
  schemas?: RouteSchemas
  meta?: OperationMeta
}

export interface OpenApiInfo {
  title?: string
  version?: string
  description?: string
}

export interface OpenApiServer {
  url: string
  description?: string
}

export interface OpenApiOptions {
  info?: OpenApiInfo
  servers?: OpenApiServer[]
  /**
   * Convert a route's Standard Schema into a JSON Schema for the document.
   * Standard Schema doesn't mandate a JSON-Schema export, so bring your own
   * (TypeBox schemas are already JSON Schema; Zod via `zod-to-json-schema`).
   * Schemas are omitted from the document when this is not provided.
   */
  toJsonSchema?: (schema: StandardSchemaV1) => unknown
}

/** A generated OpenAPI 3.1 document. */
export interface OpenApiDocument {
  openapi: string
  info: { title: string; version: string; description?: string }
  servers?: OpenApiServer[]
  paths: Record<string, Record<string, unknown>>
}

/** Convert a `/users/:id` pattern into an OpenAPI `/users/{id}` path + params. */
function toOpenApiPath(pattern: string): { path: string; params: string[] } {
  const params: string[] = []
  const path = pattern.replace(/:([^/]+)/g, (_match, name: string) => {
    params.push(name)
    return `{${name}}`
  })
  return { path, params }
}

/** Extract `{ properties, required }` from a JSON-Schema-shaped object. */
function objectShape(
  jsonSchema: unknown,
): { properties: Record<string, unknown>; required: string[] } | undefined {
  if (jsonSchema && typeof jsonSchema === 'object') {
    const s = jsonSchema as {
      properties?: Record<string, unknown>
      required?: string[]
    }
    if (s.properties)
      return { properties: s.properties, required: s.required ?? [] }
  }
  return undefined
}

/** A readable default operationId, e.g. `GET /users/{id}` → `getUsersId`. */
function defaultOperationId(method: string, path: string): string {
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((p) => p.replace(/[{}]/g, ''))
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
  return method.toLowerCase() + parts.join('')
}

/** Build an OpenAPI 3.1 document from mounted operations. */
export function buildOpenApi(
  operations: readonly OperationRecord[],
  options: OpenApiOptions = {},
): OpenApiDocument {
  const toJson = options.toJsonSchema
  const convert = (schema: StandardSchemaV1 | undefined): unknown =>
    schema && toJson ? toJson(schema) : undefined

  const paths: Record<string, Record<string, unknown>> = {}

  for (const op of operations) {
    const { path, params } = toOpenApiPath(op.pattern)
    paths[path] ??= {}
    const pathItem = paths[path]

    const parameters: unknown[] = []
    const paramShape = objectShape(convert(op.schemas?.params))
    for (const name of params) {
      parameters.push({
        name,
        in: 'path',
        required: true,
        schema: paramShape?.properties[name] ?? { type: 'string' },
      })
    }
    const queryShape = objectShape(convert(op.schemas?.query))
    if (queryShape) {
      for (const [name, schema] of Object.entries(queryShape.properties)) {
        parameters.push({
          name,
          in: 'query',
          required: queryShape.required.includes(name),
          schema,
        })
      }
    }

    const operation: Record<string, unknown> = {
      operationId: op.meta?.operationId ?? defaultOperationId(op.method, path),
    }
    if (op.meta?.summary) operation.summary = op.meta.summary
    if (op.meta?.description) operation.description = op.meta.description
    if (op.meta?.tags) operation.tags = op.meta.tags
    if (op.meta?.deprecated) operation.deprecated = true
    if (parameters.length) operation.parameters = parameters

    const bodySchema = convert(op.schemas?.body)
    if (bodySchema) {
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: bodySchema } },
      }
    }

    const responseSchema = convert(op.schemas?.response)
    operation.responses = responseSchema
      ? {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: responseSchema } },
          },
        }
      : { '200': { description: 'OK' } }

    pathItem[op.method.toLowerCase()] = operation
  }

  return {
    openapi: '3.1.0',
    info: {
      title: options.info?.title ?? 'turnover API',
      version: options.info?.version ?? '0.0.0',
      ...(options.info?.description
        ? { description: options.info.description }
        : {}),
    },
    ...(options.servers ? { servers: options.servers } : {}),
    paths,
  }
}
