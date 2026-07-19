import { describe, expect, test } from 'bun:test'
import { Mailer, memoryTransport } from '../src'

describe('Mailer', () => {
  test('normalizes recipients and applies the default from', async () => {
    const transport = memoryTransport()
    const mailer = new Mailer({ transport, from: 'no-reply@acme.io' })
    const sent = await mailer.send({
      to: 'ada@acme.io',
      subject: 'Hi',
      text: 'Welcome!',
    })
    expect(sent.to).toEqual(['ada@acme.io'])
    expect(sent.from).toBe('no-reply@acme.io')
    expect(sent.cc).toEqual([])
    expect(transport.sent).toHaveLength(1)
    expect(transport.sent[0]?.subject).toBe('Hi')
  })

  test('keeps multiple recipients and passes cc/bcc/replyTo through', async () => {
    const transport = memoryTransport()
    const mailer = new Mailer({ transport, from: 'no-reply@acme.io' })
    const sent = await mailer.send({
      to: ['a@acme.io', 'b@acme.io'],
      cc: 'c@acme.io',
      bcc: ['d@acme.io'],
      replyTo: 'support@acme.io',
      subject: 'Team',
      html: '<p>hello</p>',
    })
    expect(sent.to).toEqual(['a@acme.io', 'b@acme.io'])
    expect(sent.cc).toEqual(['c@acme.io'])
    expect(sent.bcc).toEqual(['d@acme.io'])
    expect(sent.replyTo).toBe('support@acme.io')
  })

  test('a per-message from overrides the default', async () => {
    const transport = memoryTransport()
    const mailer = new Mailer({ transport, from: 'default@acme.io' })
    const sent = await mailer.send({
      to: 'ada@acme.io',
      from: 'special@acme.io',
      subject: 'Hi',
      text: 'x',
    })
    expect(sent.from).toBe('special@acme.io')
  })

  test('rejects a message with no recipients', async () => {
    const mailer = new Mailer({ from: 'no-reply@acme.io' })
    await expect(
      mailer.send({ to: [], subject: 'Hi', text: 'x' }),
    ).rejects.toThrow(/to/)
  })

  test('rejects a message with no from and no default', async () => {
    const mailer = new Mailer()
    await expect(
      mailer.send({ to: 'ada@acme.io', subject: 'Hi', text: 'x' }),
    ).rejects.toThrow(/from/)
  })

  test('rejects a message with no subject', async () => {
    const mailer = new Mailer({ from: 'no-reply@acme.io' })
    await expect(
      mailer.send({ to: 'ada@acme.io', subject: '', text: 'x' }),
    ).rejects.toThrow(/subject/)
  })

  test('rejects a message with neither text nor html', async () => {
    const mailer = new Mailer({ from: 'no-reply@acme.io' })
    await expect(
      mailer.send({ to: 'ada@acme.io', subject: 'Hi' }),
    ).rejects.toThrow(/body/)
  })

  test('memoryTransport clear() forgets captured messages', async () => {
    const transport = memoryTransport()
    const mailer = new Mailer({ transport, from: 'no-reply@acme.io' })
    await mailer.send({ to: 'ada@acme.io', subject: 'Hi', text: 'x' })
    expect(transport.sent).toHaveLength(1)
    transport.clear()
    expect(transport.sent).toHaveLength(0)
  })
})
