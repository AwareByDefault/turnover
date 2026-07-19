import { describe, expect, test } from 'bun:test'
import {
  type Context,
  controller,
  createApp,
  createClient,
  get,
  NotFoundError,
  post,
} from '../src'

interface User {
  id: string
  name: string
}

// A hand-written `paths` type, as `openapi-typescript` would emit from the spec.
interface Paths {
  '/users/{id}': {
    get: {
      parameters: { path: { id: string } }
      responses: { 200: { content: { 'application/json': User } } }
    }
  }
  '/users': {
    get: {
      parameters: { query: { limit?: number } }
      responses: { 200: { content: { 'application/json': User[] } } }
    }
    post: {
      requestBody: { content: { 'application/json': { name: string } } }
      responses: { 201: { content: { 'application/json': User } } }
    }
  }
  '/health': {
    get: {
      responses: { 200: { content: { 'application/json': { ok: boolean } } } }
    }
  }
}

@controller('/users')
class UsersController {
  private readonly users = new Map<string, User>([
    ['1', { id: '1', name: 'Ada' }],
  ])

  @get('/')
  list(ctx: Context) {
    const limit = Number(ctx.query.get('limit') ?? '100')
    return [...this.users.values()].slice(0, limit)
  }

  @get('/:id')
  one(ctx: Context<{ id: string }>) {
    const user = this.users.get(ctx.params.id)
    if (!user) throw new NotFoundError('no such user')
    return user
  }

  @post('/')
  async create(ctx: Context) {
    const body = await ctx.body<{ name: string }>()
    const user: User = { id: '2', name: body.name }
    this.users.set(user.id, user)
    return Response.json(user, { status: 201 })
  }
}

@controller('/health')
class HealthController {
  @get('/')
  ok() {
    return { ok: true }
  }
}

const app = await createApp({
  controllers: [UsersController, HealthController],
})
// Drive the real app in-memory by using `handle` as the client's fetch.
const api = createClient<Paths>({
  baseUrl: 'http://local',
  fetch: (req) => app.handle(req),
})

describe('typed client', () => {
  test('GET with a path param returns the typed body', async () => {
    const { data, response } = await api.get('/users/{id}', {
      params: { path: { id: '1' } },
    })
    expect(response.status).toBe(200)
    expect(data).toEqual({ id: '1', name: 'Ada' })
    const _typed: User | undefined = data // compile-time: data is User
    void _typed
  })

  test('GET with query params', async () => {
    const { data } = await api.get('/users', {
      params: { query: { limit: 5 } },
    })
    expect(data).toEqual([{ id: '1', name: 'Ada' }])
  })

  test('POST with a typed body returns 201', async () => {
    const { data, response } = await api.post('/users', {
      body: { name: 'Bob' },
    })
    expect(response.status).toBe(201)
    expect(data).toEqual({ id: '2', name: 'Bob' })
  })

  test('a non-2xx populates error, not data', async () => {
    const { data, error, response } = await api.get('/users/{id}', {
      params: { path: { id: '99' } },
    })
    expect(data).toBeUndefined()
    expect(response.status).toBe(404)
    expect(error).toMatchObject({ error: { message: 'no such user' } })
  })

  test('options are optional for a param-less route', async () => {
    const { data } = await api.get('/health')
    expect(data).toEqual({ ok: true })
  })
})
