import { describe, expect, spyOn, test } from 'bun:test'
import {
  type Context,
  controller,
  createApp,
  type Guard,
  get,
  post,
  type StandardIssue,
  type StandardResult,
  type StandardSchemaV1,
  use,
} from '../src'

// ---------------------------------------------------------------------------
// A tiny hand-rolled Standard Schema implementation. The framework only speaks
// the Standard Schema interface, so this stands in for Zod/Valibot/TypeBox and
// proves compatibility without adding a dependency.
// ---------------------------------------------------------------------------

function schema<T>(
  validate: (v: unknown) => StandardResult<T>,
): StandardSchemaV1<unknown, T> {
  return { '~standard': { version: 1, vendor: 'test', validate } }
}

const str = schema<string>((v) =>
  typeof v === 'string'
    ? { value: v }
    : { issues: [{ message: 'expected string' }] },
)

/** Coerces numeric strings to numbers (like a query/param schema would). */
const num = schema<number>((v) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n)
    ? { value: n }
    : { issues: [{ message: 'expected number' }] }
})

/** An object schema that validates each field and strips unknown keys. */
function object(
  shape: Record<string, StandardSchemaV1>,
): StandardSchemaV1<unknown, Record<string, unknown>> {
  return schema<Record<string, unknown>>((v) => {
    if (typeof v !== 'object' || v === null) {
      return { issues: [{ message: 'expected object' }] }
    }
    const input = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    const issues: StandardIssue[] = []
    for (const [key, member] of Object.entries(shape)) {
      const r = member['~standard'].validate(
        input[key],
      ) as StandardResult<unknown>
      if (r.issues) {
        for (const issue of r.issues) {
          issues.push({
            message: issue.message,
            path: [key, ...(issue.path ?? [])],
          })
        }
      } else {
        out[key] = r.value
      }
    }
    return issues.length ? { issues } : { value: out }
  })
}

const CreateUser = object({ name: str, age: num })
const UserParams = object({ id: num })
const SearchQuery = object({ q: str, limit: num })
const UserResponse = object({ id: num, name: str })

@controller('/v')
class ValidationController {
  @post('/users', { body: CreateUser })
  create(ctx: Context) {
    return { received: ctx.valid.body }
  }

  @post('/raw', { body: CreateUser })
  async raw(ctx: Context) {
    return { raw: await ctx.body(), valid: ctx.valid.body }
  }

  @get('/users/:id', { params: UserParams })
  getOne(ctx: Context) {
    return ctx.valid.params
  }

  @get('/search', { query: SearchQuery })
  search(ctx: Context) {
    return ctx.valid.query
  }

  @get('/response-good', { response: UserResponse })
  good() {
    return { id: 1, name: 'Ada', secret: 'leak' }
  }

  @get('/response-bad', { response: UserResponse })
  bad() {
    return { id: 'not-a-number', name: 5 }
  }

  @get('/none')
  none(ctx: Context) {
    return { valid: ctx.valid }
  }
}

const app = await createApp({ controllers: [ValidationController] })

function post_(path: string, body: unknown): Request {
  return new Request(`http://t${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('body validation', () => {
  test('valid body is validated and exposed on ctx.valid.body', async () => {
    const res = await app.handle(post_('/v/users', { name: 'Ada', age: '30' }))
    expect(res.status).toBe(200)
    // "30" was coerced to the number 30 by the schema.
    expect(await res.json()).toEqual({ received: { name: 'Ada', age: 30 } })
  })

  test('invalid body 422s with location + issue paths', async () => {
    const res = await app.handle(post_('/v/users', { name: 123 }))
    expect(res.status).toBe(422)
    const body = (await res.json()) as any
    expect(body.error.code).toBe('validation_failed')
    expect(body.error.details.location).toBe('body')
    expect(body.error.details.issues.length).toBeGreaterThan(0)
    expect(body.error.details.issues[0].path).toEqual(['name'])
  })

  test('ctx.body() still returns the raw (pre-validation) body', async () => {
    const res = await app.handle(post_('/v/raw', { name: 'Ada', age: '30' }))
    const body = (await res.json()) as any
    expect(body.raw).toEqual({ name: 'Ada', age: '30' }) // raw: age is a string
    expect(body.valid).toEqual({ name: 'Ada', age: 30 }) // valid: coerced to number
  })
})

describe('params & query validation', () => {
  test('valid params are coerced onto ctx.valid.params', async () => {
    const res = await app.handle(new Request('http://t/v/users/42'))
    expect(await res.json()).toEqual({ id: 42 })
  })

  test('invalid params 422 with location params', async () => {
    const res = await app.handle(new Request('http://t/v/users/abc'))
    expect(res.status).toBe(422)
    expect((await res.json()).error.details.location).toBe('params')
  })

  test('valid query is coerced onto ctx.valid.query', async () => {
    const res = await app.handle(new Request('http://t/v/search?q=hi&limit=5'))
    expect(await res.json()).toEqual({ q: 'hi', limit: 5 })
  })

  test('invalid query 422 with location query', async () => {
    const res = await app.handle(new Request('http://t/v/search?q=hi'))
    expect(res.status).toBe(422)
    expect((await res.json()).error.details.location).toBe('query')
  })
})

describe('response validation', () => {
  test('a valid response is validated and extra fields are stripped', async () => {
    const res = await app.handle(new Request('http://t/v/response-good'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: 1, name: 'Ada' }) // "secret" stripped by the schema
    expect(JSON.stringify(body)).not.toContain('leak')
  })

  test('an invalid response is an opaque 500 (server bug) and is logged', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    const res = await app.handle(new Request('http://t/v/response-bad'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: { message: 'Internal Server Error' },
    })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('no schema declared', () => {
  test('ctx.valid is empty and nothing is validated', async () => {
    const res = await app.handle(new Request('http://t/v/none'))
    expect(await res.json()).toEqual({ valid: {} })
  })
})

describe('guards run before validation', () => {
  const deny: Guard = () => new Response('nope', { status: 401 })

  @controller('/vg')
  @use(deny)
  class GuardedValidationController {
    @post('/', { body: CreateUser })
    create() {
      return { ok: true }
    }
  }

  test('a guard short-circuits before an invalid body is validated', async () => {
    const gapp = await createApp({ controllers: [GuardedValidationController] })
    // Body is invalid (would 422), but the guard denies first → 401.
    const res = await gapp.handle(post_('/vg', { totally: 'invalid' }))
    expect(res.status).toBe(401)
  })
})
