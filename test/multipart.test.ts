import { describe, expect, test } from 'bun:test'
import {
  type Context,
  controller,
  createApp,
  type MultipartBody,
  multipart,
  post,
} from '../src'

@controller('/up')
class Up {
  @post('/')
  async upload(ctx: Context) {
    const body = await ctx.body<MultipartBody>()
    const avatar = body.files.avatar?.[0]
    return {
      fields: body.fields,
      avatarCount: body.files.avatar?.length ?? 0,
      file: avatar
        ? {
            name: avatar.filename,
            type: avatar.type,
            size: avatar.size,
            text: await avatar.text(),
          }
        : null,
    }
  }
}

function withFiles(parts: Array<[string, string] | [string, File]>): Request {
  const form = new FormData()
  for (const [name, value] of parts) form.append(name, value as never)
  return new Request('http://t/up', { method: 'POST', body: form })
}

const file = (content: string, name: string, type: string): File =>
  new File([content], name, { type })

describe('multipart()', () => {
  test('parses fields and files from a multipart body', async () => {
    const app = await createApp({ controllers: [Up], plugins: [multipart()] })
    const res = await app.handle(
      withFiles([
        ['name', 'Ada'],
        ['avatar', file('hello', 'a.txt', 'text/plain')],
      ]),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      fields: Record<string, string>
      avatarCount: number
      file: { name: string; type: string; size: number; text: string }
    }
    expect(json.fields).toEqual({ name: 'Ada' })
    expect(json.avatarCount).toBe(1)
    expect(json.file.name).toBe('a.txt')
    // The multipart round-trip appends a charset to text types.
    expect(json.file.type).toContain('text/plain')
    expect(json.file.size).toBe(5)
    expect(json.file.text).toBe('hello')
  })

  test('groups repeated field names into an array of files', async () => {
    const app = await createApp({ controllers: [Up], plugins: [multipart()] })
    const res = await app.handle(
      withFiles([
        ['avatar', file('one', 'a.txt', 'text/plain')],
        ['avatar', file('two', 'b.txt', 'text/plain')],
      ]),
    )
    expect((await res.json()).avatarCount).toBe(2)
  })

  test('rejects a file over maxFileSize with 413', async () => {
    const app = await createApp({
      controllers: [Up],
      plugins: [multipart({ maxFileSize: 3 })],
    })
    const res = await app.handle(
      withFiles([['avatar', file('hello', 'a.txt', 'text/plain')]]),
    )
    expect(res.status).toBe(413)
  })

  test('rejects a disallowed type with 415', async () => {
    const app = await createApp({
      controllers: [Up],
      plugins: [multipart({ allowedTypes: ['image/*'] })],
    })
    const res = await app.handle(
      withFiles([['avatar', file('x', 'a.txt', 'text/plain')]]),
    )
    expect(res.status).toBe(415)
  })

  test('accepts an allowed wildcard type', async () => {
    const app = await createApp({
      controllers: [Up],
      plugins: [multipart({ allowedTypes: ['image/*'] })],
    })
    const res = await app.handle(
      withFiles([['avatar', file('\x89PNG', 'a.png', 'image/png')]]),
    )
    expect(res.status).toBe(200)
  })

  test('rejects more than maxFiles with 400', async () => {
    const app = await createApp({
      controllers: [Up],
      plugins: [multipart({ maxFiles: 1 })],
    })
    const res = await app.handle(
      withFiles([
        ['a', file('one', 'a.txt', 'text/plain')],
        ['b', file('two', 'b.txt', 'text/plain')],
      ]),
    )
    expect(res.status).toBe(400)
  })

  test('rejects exceeding maxTotalSize with 413', async () => {
    const app = await createApp({
      controllers: [Up],
      plugins: [multipart({ maxTotalSize: 5 })],
    })
    const res = await app.handle(
      withFiles([
        ['a', file('abc', 'a.txt', 'text/plain')],
        ['b', file('def', 'b.txt', 'text/plain')],
      ]),
    )
    expect(res.status).toBe(413)
  })
})
