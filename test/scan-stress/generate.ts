// Deterministic generator for a large, complex auto-discovery fixture.
//
// Rather than commit hundreds of near-identical boilerplate files, we generate
// them (into a gitignored directory) so the repo stays lean and the fixture is
// reproducible from this single source of truth. It exercises the filesystem
// scan at scale: many controllers, injected services, a deep cross-feature DI
// chain, auth + role guards, validation, method AOP (@before/@after/@around),
// events + listeners, plus non-controller "noise" files the scan must read and
// skip.
//
// Layout (per feature, under feature-NN/): model, events, util (noise),
// repository, service, listener, guard, schema, controller — 9 files — plus a
// handful of shared files. With 40 features that's 365 files and 240 endpoints.

import { mkdir, rm, writeFile } from 'node:fs/promises'

export interface FixtureMeta {
  root: string
  features: number
  files: number
  endpoints: number
  lines: number
}

// Cap the cross-feature DI chain at this depth (a "band"). Every BAND-th feature
// starts a fresh chain, so the fixture scales to hundreds of thousands of files
// without a pathologically deep (stack-blowing) resolution chain.
const BAND = 40

// Framework import path from a file two levels under the fixture root
// (root/feature-NN/*.ts or root/shared/*.ts → repo/src).
const FW = '../../../src'
const ENDPOINTS_PER_FEATURE = 6

const pad = (n: number): string => String(n).padStart(2, '0')

const sharedPrincipal =
  (): string => `import { getRequestState, setPrincipal } from '${FW}'
import type { Guard } from '${FW}'

declare module '${FW}/auth' {
  interface Principal {
    id: string
    roles: string[]
  }
}

const TOKENS: Record<string, { id: string; roles: string[] }> = {
  'admin-token': { id: 'admin', roles: ['admin', 'user'] },
  'user-token': { id: 'user', roles: ['user'] },
}

export const authenticate: Guard = (ctx) => {
  const header = ctx.req.headers.get('authorization')
  const token = header ? header.replace(/^Bearer\\s+/i, '') : undefined
  const user = token ? TOKENS[token] : undefined
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }
  setPrincipal(user)
}

export const requireRole =
  (role: string): Guard =>
  () => {
    const user = getRequestState()?.principal
    if (!user || !user.roles.includes(role)) {
      return new Response('Forbidden', { status: 403 })
    }
  }
`

const sharedEvents = (): string => `export class EntityCreated {
  constructor(
    readonly feature: string,
    readonly id: string,
  ) {}
}
`

const sharedAudit = (): string => `import { injectable, onEvent } from '${FW}'
import { EntityCreated } from './events'

@injectable()
export class AuditService {
  count = 0
  readonly seen: string[] = []

  @onEvent(EntityCreated)
  record(event: EntityCreated): void {
    this.count += 1
    this.seen.push(event.feature + ':' + event.id)
  }
}
`

const sharedClock = (): string => `import { injectable } from '${FW}'

@injectable()
export class Clock {
  now(): number {
    return 0
  }
}
`

const sharedConfig = (): string => `import { injectable } from '${FW}'

@injectable()
export class AppConfig {
  readonly pageSize = 20
}
`

const model = (nn: string): string => `export interface Item${nn} {
  id: string
  name: string
  value: number
}
`

const featureEvents = (nn: string): string => `export class Feature${nn}Event {
  constructor(readonly id: string) {}
}
`

const util = (
  nn: string,
): string => `// Helpers for feature ${nn}. No @controller — the scan reads this file and
// skips it, exercising the read-and-skip path at scale.

export function slugify${nn}(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

export const FEATURE_${nn}_TAG = 'feature-${nn}'
`

const repository = (nn: string): string => `import { repository } from '${FW}'
import type { Item${nn} } from './model'

@repository()
export class Repository${nn} {
  private readonly items = new Map<string, Item${nn}>()

  all(): Item${nn}[] {
    return [...this.items.values()]
  }

  get(id: string): Item${nn} | undefined {
    return this.items.get(id)
  }

  save(item: Item${nn}): Item${nn} {
    this.items.set(item.id, item)
    return item
  }

  remove(id: string): boolean {
    return this.items.delete(id)
  }
}
`

const service = (i: number): string => {
  const nn = pad(i)
  const prev = i % BAND === 0 ? null : pad(i - 1)
  const prevImport = prev
    ? `import { Service${prev} } from '../feature-${prev}/service'\n`
    : ''
  const prevField = prev
    ? `  private readonly upstream = inject(Service${prev})\n`
    : ''
  const depthBody = prev ? '1 + this.upstream.depth()' : '1'
  return `import { after, around, before, inject, injectable } from '${FW}'
import { AppConfig } from '../shared/config'
import { AuditService } from '../shared/audit'
import { Clock } from '../shared/clock'
import type { Item${nn} } from './model'
import { Repository${nn} } from './repository'
${prevImport}
@injectable()
export class Service${nn} {
  private readonly repo = inject(Repository${nn})
  private readonly audit = inject(AuditService)
  private readonly clock = inject(Clock)
  private readonly config = inject(AppConfig)
${prevField}  calls = 0
  lastAt = -1

  // Deep cross-feature DI chain: Service${nn}.depth() === ${(i % BAND) + 1}.
  depth(): number {
    return ${depthBody}
  }

  @before(() => undefined)
  @after(() => undefined)
  list(): Item${nn}[] {
    return this.repo.all().slice(0, this.config.pageSize)
  }

  @around((jp) => jp.proceed())
  create(item: Item${nn}): Item${nn} {
    this.calls += 1
    this.lastAt = this.clock.now()
    return this.repo.save(item)
  }

  get(id: string): Item${nn} | undefined {
    return this.repo.get(id)
  }

  remove(id: string): boolean {
    return this.repo.remove(id)
  }
}
`
}

const listener = (
  nn: string,
): string => `import { injectable, onEvent } from '${FW}'
import { Feature${nn}Event } from './events'

@injectable()
export class Listener${nn} {
  handled = 0

  @onEvent(Feature${nn}Event)
  on(_event: Feature${nn}Event): void {
    this.handled += 1
  }
}
`

const guard = (nn: string): string => `import type { Guard } from '${FW}'

export const guard${nn}: Guard = (ctx) => {
  if (ctx.req.headers.get('x-block') === 'feature-${nn}') {
    return new Response('blocked', { status: 403 })
  }
}
`

const schema = (
  nn: string,
): string => `import type { StandardSchemaV1 } from '${FW}'

export const createSchema${nn}: StandardSchemaV1<
  { name: string; value: number },
  { name: string; value: number }
> = {
  '~standard': {
    version: 1,
    vendor: 'stress',
    validate: (value) => {
      const o = value as { name?: unknown; value?: unknown }
      return typeof o?.name === 'string' && typeof o?.value === 'number'
        ? { value: { name: o.name, value: o.value } }
        : { issues: [{ message: 'name (string) and value (number) required' }] }
    },
  },
}
`

const controller = (nn: string): string => `import {
  type Context,
  controller,
  del,
  Events,
  get,
  inject,
  post,
  put,
  use,
} from '${FW}'
import { authenticate, requireRole } from '../shared/principal'
import { EntityCreated } from '../shared/events'
import { Feature${nn}Event } from './events'
import { guard${nn} } from './guard'
import { Listener${nn} } from './listener'
import { createSchema${nn} } from './schema'
import { Service${nn} } from './service'

@controller('/feature-${nn}')
@use(authenticate, guard${nn})
export class Controller${nn} {
  private readonly service = inject(Service${nn})
  private readonly listener = inject(Listener${nn})
  private readonly events = inject(Events)

  @get('/')
  list() {
    return { items: this.service.list() }
  }

  @get('/:id')
  getOne(ctx: Context<{ id: string }>) {
    const item = this.service.get(ctx.params.id)
    return item ? { item } : new Response('not found', { status: 404 })
  }

  @post('/', { body: createSchema${nn} })
  async create(ctx: Context) {
    const input = ctx.valid.body as { name: string; value: number }
    const item = this.service.create({
      id: crypto.randomUUID(),
      name: input.name,
      value: input.value,
    })
    await this.events.publish(new EntityCreated('feature-${nn}', item.id))
    await this.events.publish(new Feature${nn}Event(item.id))
    return { created: item }
  }

  @put('/:id')
  @use(requireRole('admin'))
  update(ctx: Context<{ id: string }>) {
    return { updated: ctx.params.id }
  }

  @del('/:id')
  @use(requireRole('admin'))
  remove(ctx: Context<{ id: string }>) {
    return { removed: this.service.remove(ctx.params.id) }
  }

  @get('/meta/info')
  info() {
    return {
      feature: '${nn}',
      calls: this.service.calls,
      handled: this.listener.handled,
      depth: this.service.depth(),
    }
  }
}
`

// A barrel listing every controller — the input for MANUAL registration
// (createApp({ controllers })), the alternative to the filesystem scan. The
// scan reads this file and skips it (no @controller in its source).
const barrel = (features: number): string => {
  const out: string[] = []
  for (let i = 0; i < features; i++) {
    out.push(
      `import { Controller${pad(i)} } from './feature-${pad(i)}/controller'`,
    )
  }
  out.push('')
  out.push('export const controllers = [')
  for (let i = 0; i < features; i++) out.push(`  Controller${pad(i)},`)
  out.push(']')
  return `${out.join('\n')}\n`
}

export async function generateScanFixture(
  root: string,
  options: { features?: number } = {},
): Promise<FixtureMeta> {
  const features = options.features ?? 40
  await rm(root, { recursive: true, force: true })
  await mkdir(`${root}/shared`, { recursive: true })

  let files = 0
  let lines = 0
  const write = (rel: string, content: string) => {
    files += 1
    lines += content.split('\n').length - 1
    return writeFile(`${root}/${rel}`, content)
  }

  await Promise.all([
    write('shared/principal.ts', sharedPrincipal()),
    write('shared/events.ts', sharedEvents()),
    write('shared/audit.ts', sharedAudit()),
    write('shared/clock.ts', sharedClock()),
    write('shared/config.ts', sharedConfig()),
  ])

  for (let i = 0; i < features; i++) {
    const nn = pad(i)
    const dir = `feature-${nn}`
    await mkdir(`${root}/${dir}`, { recursive: true })
    await Promise.all([
      write(`${dir}/model.ts`, model(nn)),
      write(`${dir}/events.ts`, featureEvents(nn)),
      write(`${dir}/util.ts`, util(nn)),
      write(`${dir}/repository.ts`, repository(nn)),
      write(`${dir}/service.ts`, service(i)),
      write(`${dir}/listener.ts`, listener(nn)),
      write(`${dir}/guard.ts`, guard(nn)),
      write(`${dir}/schema.ts`, schema(nn)),
      write(`${dir}/controller.ts`, controller(nn)),
    ])
  }

  await write('controllers.ts', barrel(features))

  return {
    root,
    features,
    files,
    endpoints: features * ENDPOINTS_PER_FEATURE,
    lines,
  }
}
