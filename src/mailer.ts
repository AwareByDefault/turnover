/** An email address, optionally with a display name (`"Ada <ada@acme.io>"`). */
export type Address = string

/** A message handed to {@link Mailer.send}. */
export interface Mail {
  to: Address | Address[]
  /** Sender; falls back to the mailer's default `from`. */
  from?: Address
  cc?: Address | Address[]
  bcc?: Address | Address[]
  replyTo?: Address
  subject: string
  /** Plain-text body. At least one of `text`/`html` is required. */
  text?: string
  /** HTML body. */
  html?: string
  /** Extra headers. */
  headers?: Record<string, string>
}

/** A normalized message: recipient fields as arrays and a resolved `from`. */
export interface OutgoingMail extends Mail {
  to: Address[]
  from: Address
  cc: Address[]
  bcc: Address[]
}

/** Delivers a normalized message. Implement this over SMTP or a mail API. */
export interface MailTransport {
  send(mail: OutgoingMail): Promise<void>
}

/** A {@link MailTransport} that records messages instead of sending — for tests and dev. */
export interface MemoryTransport extends MailTransport {
  /** Messages captured so far, in send order. */
  readonly sent: OutgoingMail[]
  /** Forget all captured messages. */
  clear(): void
}

/** Build an in-memory transport that captures every message it is handed. */
export function memoryTransport(): MemoryTransport {
  const sent: OutgoingMail[] = []
  return {
    sent,
    async send(mail) {
      sent.push(mail)
    },
    clear() {
      sent.length = 0
    },
  }
}

/** Options for {@link Mailer}. */
export interface MailerOptions {
  /** Transport that delivers messages (default {@link memoryTransport}). */
  transport?: MailTransport
  /** Default sender applied when a message omits `from`. */
  from?: Address
}

function toArray(value: Address | Address[] | undefined): Address[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * A transport-agnostic email sender. Normalizes and validates a {@link Mail}
 * (recipient fields to arrays, default `from`, at least one recipient and a
 * body) then hands it to a {@link MailTransport}. Ships {@link memoryTransport}
 * for tests and dev; plug an SMTP or API transport in production. Register it as
 * a provider to `inject(Mailer)` it in controllers.
 *
 * ```ts
 * const mailer = new Mailer({ from: 'Acme <no-reply@acme.io>' })
 * await mailer.send({ to: 'ada@acme.io', subject: 'Hi', text: 'Welcome!' })
 * ```
 */
export class Mailer {
  private readonly transport: MailTransport
  private readonly defaultFrom?: Address

  constructor(options: MailerOptions = {}) {
    this.transport = options.transport ?? memoryTransport()
    this.defaultFrom = options.from
  }

  /** Normalize, validate, and deliver a message; returns what was sent. */
  async send(mail: Mail): Promise<OutgoingMail> {
    const to = toArray(mail.to)
    if (to.length === 0) {
      throw new Error('Mail requires at least one "to" recipient.')
    }
    const from = mail.from ?? this.defaultFrom
    if (!from) {
      throw new Error('Mail requires a "from" address (set one on the mailer).')
    }
    if (!mail.subject) throw new Error('Mail requires a "subject".')
    if (!mail.text && !mail.html) {
      throw new Error('Mail requires a "text" or "html" body.')
    }
    const outgoing: OutgoingMail = {
      ...mail,
      to,
      from,
      cc: toArray(mail.cc),
      bcc: toArray(mail.bcc),
    }
    await this.transport.send(outgoing)
    return outgoing
  }
}
