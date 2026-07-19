import { describe, expect, test } from 'bun:test'
import { controller, createApp, get, post, type StandardSchemaV1 } from '../src'

/** A schema whose object *is* a JSON Schema (like TypeBox), plus `~standard`. */
function schema(jsonSchema: Record<string, unknown>): StandardSchemaV1 {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (v: unknown) => ({ value: v }),
    },
    ...jsonSchema,
  } as unknown as StandardSchemaV1
}

/** A user-supplied converter: strip `~standard`, leaving the JSON Schema. */
const toJsonSchema = (s: StandardSchemaV1): unknown => {
  const { '~standard': _omit, ...json } = s as unknown as Record<
    string,
    unknown
  >
  return json
}

@controller('/users')
class DocUsersController {
  @get('/', {
    query: schema({
      type: 'object',
      properties: { q: { type: 'string' } },
      required: ['q'],
    }),
    openapi: { summary: 'List users', tags: ['users'] },
  })
  list() {
    return []
  }

  @get('/:id', {
    params: schema({ type: 'object', properties: { id: { type: 'integer' } } }),
    response: schema({
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' } },
    }),
    openapi: { operationId: 'getUser' },
  })
  one() {
    return {}
  }

  @post('/', {
    body: schema({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    }),
  })
  create() {
    return {}
  }
}

@controller('/health')
class DocHealthController {
  @get('/', { openapi: { deprecated: true } })
  health() {
    return { ok: true }
  }
}

const app = await createApp({
  controllers: [DocUsersController, DocHealthController],
})

describe('openapi() document shape', () => {
  const doc = app.openapi({ toJsonSchema }) as any

  test('is an OpenAPI 3.1 document with default info', () => {
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info).toEqual({ title: 'turnover API', version: '0.0.0' })
  })

  test('custom info and servers are applied', () => {
    const d = app.openapi({
      info: { title: 'My API', version: '2.1.0', description: 'hi' },
      servers: [{ url: 'https://api.example.com' }],
    }) as any
    expect(d.info).toEqual({
      title: 'My API',
      version: '2.1.0',
      description: 'hi',
    })
    expect(d.servers).toEqual([{ url: 'https://api.example.com' }])
  })

  test('routes become paths with :param converted to {param}', () => {
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/health',
      '/users',
      '/users/{id}',
    ])
  })

  test('multiple methods on one path merge into a single path item', () => {
    expect(Object.keys(doc.paths['/users']).sort()).toEqual(['get', 'post'])
  })
})

describe('operation metadata & parameters', () => {
  const doc = app.openapi({ toJsonSchema }) as any

  test('summary, tags, and a default operationId', () => {
    const op = doc.paths['/users'].get
    expect(op.summary).toBe('List users')
    expect(op.tags).toEqual(['users'])
    expect(op.operationId).toBe('getUsers')
  })

  test('query parameters come from the query schema', () => {
    const params = doc.paths['/users'].get.parameters
    expect(params).toContainEqual({
      name: 'q',
      in: 'query',
      required: true,
      schema: { type: 'string' },
    })
  })

  test('path parameters carry the params schema and a custom operationId', () => {
    const op = doc.paths['/users/{id}'].get
    expect(op.operationId).toBe('getUser')
    expect(op.parameters).toContainEqual({
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'integer' },
    })
  })

  test('requestBody comes from the body schema', () => {
    const op = doc.paths['/users'].post
    expect(op.requestBody.required).toBe(true)
    expect(op.requestBody.content['application/json'].schema).toMatchObject({
      type: 'object',
      properties: { name: { type: 'string' } },
    })
  })

  test('responses come from the response schema', () => {
    const op = doc.paths['/users/{id}'].get
    expect(
      op.responses['200'].content['application/json'].schema,
    ).toMatchObject({
      type: 'object',
    })
  })

  test('deprecated + default operationId for a bare route', () => {
    const op = doc.paths['/health'].get
    expect(op.deprecated).toBe(true)
    expect(op.operationId).toBe('getHealth')
    expect(op.responses['200']).toEqual({ description: 'OK' })
  })
})

describe('without a toJsonSchema converter', () => {
  const doc = app.openapi() as any

  test('path params default to string, and schemas are omitted', () => {
    const one = doc.paths['/users/{id}'].get
    expect(one.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ])
    expect(doc.paths['/users'].post.requestBody).toBeUndefined()
    expect(doc.paths['/users'].get.parameters).toBeUndefined() // no query params
  })
})

describe('serving the document', () => {
  test('can be served via an onRequest hook', async () => {
    const served = await createApp({
      controllers: [DocUsersController],
      onRequest: [
        (req) =>
          new URL(req.url).pathname === '/openapi.json'
            ? Response.json(served.openapi({ toJsonSchema }))
            : undefined,
      ],
    })
    const res = await served.handle(new Request('http://t/openapi.json'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.openapi).toBe('3.1.0')
    expect(body.paths['/users/{id}']).toBeDefined()
  })
})
