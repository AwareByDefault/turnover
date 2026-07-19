import { describe, expect, test } from 'bun:test'
import {
  controller,
  createApp,
  get,
  HttpError,
  NotFoundError,
  problemDetails,
} from '../src'

@controller('/p')
class P {
  @get('/missing')
  missing() {
    throw new NotFoundError('user 5 not found')
  }
  @get('/coded')
  coded() {
    throw new HttpError(409, 'duplicate key', { code: 'dup_key' })
  }
  @get('/boom')
  boom(): never {
    throw new Error('secret internal detail')
  }
}

describe('problemDetails()', () => {
  test('renders an HttpError as application/problem+json', async () => {
    const app = await createApp({
      controllers: [P],
      plugins: [problemDetails()],
    })
    const res = await app.handle(new Request('http://t/p/missing'))
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toBe('application/problem+json')
    expect(await res.json()).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'user 5 not found',
      instance: '/p/missing',
    })
  })

  test('includes a machine-readable code when present', async () => {
    const app = await createApp({
      controllers: [P],
      plugins: [problemDetails()],
    })
    const res = await app.handle(new Request('http://t/p/coded'))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      status: 409,
      title: 'Conflict',
      detail: 'duplicate key',
      code: 'dup_key',
    })
  })

  test('renders an unknown error as an opaque 500 without leaking the message', async () => {
    const app = await createApp({
      controllers: [P],
      plugins: [problemDetails()],
    })
    const res = await app.handle(new Request('http://t/p/boom'))
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toBe('application/problem+json')
    const body = await res.json()
    expect(body).toMatchObject({ status: 500, title: 'Internal Server Error' })
    expect(JSON.stringify(body)).not.toContain('secret internal detail')
  })

  test('is opt-in — without the plugin the default JSON envelope is used', async () => {
    const app = await createApp({ controllers: [P] })
    const res = await app.handle(new Request('http://t/p/missing'))
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: { message: 'user 5 not found' } })
  })
})
