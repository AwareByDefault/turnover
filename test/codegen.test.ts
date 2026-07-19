import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { OpenApiDocument } from '../src'
import { generateClient } from '../src/codegen'

const user = {
  type: 'object',
  properties: { id: { type: 'string' }, name: { type: 'string' } },
  required: ['id', 'name'],
}

const doc: OpenApiDocument = {
  openapi: '3.1.0',
  info: { title: 'Test', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer' },
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': { schema: { type: 'array', items: user } },
            },
          },
        },
      },
      post: {
        operationId: 'createUser',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: { 'application/json': { schema: user } },
          },
        },
      },
    },
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: user } },
          },
        },
      },
    },
  },
}

describe('generateClient()', () => {
  test('emits typed methods per operation', () => {
    const source = generateClient(doc)
    expect(source).toContain('export function createClient(')
    expect(source).toContain('async listUsers(')
    expect(source).toContain('async getUser(req: { params: { "id": string }')
    expect(source).toContain('async createUser(req: { body: { "name": string }')
    // Response types are derived from the 2xx schema.
    expect(source).toContain('Promise<Array<{ "id": string; "name": string }>>')
  })

  test('honours a custom client name', () => {
    expect(generateClient(doc, { clientName: 'apiClient' })).toContain(
      'export function apiClient(',
    )
  })
})

// Prove the generated client actually works: write it, import it, and drive it
// with a fake fetch.
describe('generated client (executed)', () => {
  let dir: string
  // biome-ignore lint/suspicious/noExplicitAny: dynamically imported generated module
  let mod: any

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'turnover-codegen-'))
    const file = join(dir, 'client.ts')
    writeFileSync(file, generateClient(doc))
    mod = await import(pathToFileURL(file).href)
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  function fakeFetch(body: unknown) {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fn = async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      })
    }
    return Object.assign(fn, { calls })
  }

  test('builds a GET with a path param', async () => {
    const fetch = fakeFetch({ id: '42', name: 'Ada' })
    const client = mod.createClient({ baseUrl: 'http://api.test', fetch })
    const result = await client.getUser({ params: { id: '42' } })
    expect(fetch.calls[0]?.url).toBe('http://api.test/users/42')
    expect(fetch.calls[0]?.init?.method).toBe('GET')
    expect(result).toEqual({ id: '42', name: 'Ada' })
  })

  test('builds a POST with a JSON body', async () => {
    const fetch = fakeFetch({ id: '1', name: 'Ada' })
    const client = mod.createClient({ baseUrl: 'http://api.test', fetch })
    await client.createUser({ body: { name: 'Ada' } })
    expect(fetch.calls[0]?.url).toBe('http://api.test/users')
    expect(fetch.calls[0]?.init?.method).toBe('POST')
    expect(fetch.calls[0]?.init?.body).toBe('{"name":"Ada"}')
    const headers = fetch.calls[0]?.init?.headers as Record<string, string>
    expect(headers['content-type']).toBe('application/json')
  })

  test('appends query params and allows omitting the request', async () => {
    const fetch = fakeFetch([])
    const client = mod.createClient({ baseUrl: 'http://api.test', fetch })
    await client.listUsers({ query: { limit: 5 } })
    expect(fetch.calls[0]?.url).toBe('http://api.test/users?limit=5')
    // The request argument is optional when it has no required fields.
    await client.listUsers()
    expect(fetch.calls[1]?.url).toBe('http://api.test/users')
  })
})
