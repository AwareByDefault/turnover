import type { RouteSchemas, StandardSchemaV1 } from './schema'

/** OpenAPI metadata a route can declare (via its decorator options). */
export interface OperationMeta {
  /** One-line summary shown as the operation's title in docs UIs. */
  summary?: string
  /** Longer description; CommonMark/Markdown is rendered by docs UIs. */
  description?: string
  /** Tags that group the operation into sidebar sections in docs UIs. */
  tags?: string[]
  /** Explicit operation id; must be unique across the document and is reused as the generated client's method name. Falls back to a readable id derived from method + path (e.g. `getUsersId`) when omitted. */
  operationId?: string
  /** Flag the operation deprecated (docs UIs render it struck-through). */
  deprecated?: boolean
}

/** One mounted route, captured for OpenAPI generation. */
export interface OperationRecord {
  /** The HTTP method in uppercase (e.g. `GET`); lowercased when written as the path-item key. */
  method: string
  /** The normalized route pattern with `:name` params (e.g. `/users/:id`), converted to `/users/{id}` in the output. */
  pattern: string
  /** Standard Schemas declared for the route's inputs and output. */
  schemas?: RouteSchemas
  /** OpenAPI metadata declared on the route. */
  meta?: OperationMeta
}

/** The `info` block of the generated OpenAPI document. */
export interface OpenApiInfo {
  /**
   * API title.
   * @defaultValue `'turnover API'`
   */
  title?: string
  /**
   * API version.
   * @defaultValue `'0.0.0'`
   */
  version?: string
  /** API description. */
  description?: string
}

/** A server entry advertised in the OpenAPI document. */
export interface OpenApiServer {
  /** Base URL of the server. */
  url: string
  /** Human-readable description of the server. */
  description?: string
}

/** Options for building an OpenAPI document. */
export interface OpenApiOptions {
  /** Document metadata (`title`, `version`, `description`). */
  info?: OpenApiInfo
  /** Server entries to advertise. */
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
  /** The OpenAPI spec version — always the literal `"3.1.0"`. */
  openapi: string
  /** Document metadata with defaults resolved, so `title` and `version` are always present (unlike the all-optional {@link OpenApiInfo}). */
  info: { title: string; version: string; description?: string }
  /** Advertised servers, if any. */
  servers?: OpenApiServer[]
  /** Path items keyed by path, each keyed by lowercased HTTP method. */
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

/**
 * Build an OpenAPI 3.1 document from mounted operations.
 *
 * @remarks
 * Path params are always emitted as `required` (typed from the route's `params`
 * schema, or `{ type: 'string' }` when it has none). A request body is marked
 * `required`. Every operation gets a single `200` response — carrying the
 * `response` schema when one is declared, otherwise just `{ description: 'OK' }`.
 * Input/output schemas appear only when `options.toJsonSchema` is supplied;
 * without it the document still has all paths, params, and metadata but no
 * request/response schemas.
 *
 * @param operations - the mounted route records to document
 * @param options - document info, servers, and a Standard-Schema-to-JSON-Schema converter
 * @returns the generated {@link OpenApiDocument}
 */
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
