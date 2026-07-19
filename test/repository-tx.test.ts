import { describe, expect, test } from 'bun:test'
import {
  Container,
  repository,
  service,
  TRANSACTION_MANAGER,
  type TransactionManager,
  transactional,
  transactionalProcessor,
} from '../src'

class RecordingManager implements TransactionManager {
  runs = 0
  rollbacks = 0
  async run<T>(fn: () => T | Promise<T>): Promise<T> {
    this.runs++
    try {
      return await fn()
    } catch (err) {
      this.rollbacks++
      throw err
    }
  }
}

function wired() {
  const mgr = new RecordingManager()
  const container = new Container()
  container.register(TRANSACTION_MANAGER, { useValue: mgr })
  container.addPostProcessor(transactionalProcessor(container))
  return { mgr, container }
}

describe('@repository auto-transactional', () => {
  test('runs every own method inside the transaction manager', async () => {
    @repository()
    class UserRepo {
      saved: string[] = []
      save(name: string) {
        this.saved.push(name)
        return name
      }
      count() {
        return this.saved.length
      }
    }
    const { mgr, container } = wired()
    const repo = container.resolve(UserRepo)
    expect(await repo.save('alice')).toBe('alice')
    expect(await repo.count()).toBe(1)
    expect(mgr.runs).toBe(2)
    expect(repo.saved).toEqual(['alice'])
  })

  test('rolls back when a repository method throws', async () => {
    @repository()
    class Repo {
      boom(): never {
        throw new Error('db error')
      }
    }
    const { mgr, container } = wired()
    const repo = container.resolve(Repo)
    await expect(repo.boom()).rejects.toThrow('db error')
    expect(mgr.runs).toBe(1)
    expect(mgr.rollbacks).toBe(1)
  })

  test('@service methods are not auto-transactional', () => {
    @service()
    class Plain {
      go() {
        return 'ok'
      }
    }
    const { mgr, container } = wired()
    expect(container.resolve(Plain).go()).toBe('ok')
    expect(mgr.runs).toBe(0)
  })

  test('explicit @transactional still wraps only that method', async () => {
    @service()
    class Mixed {
      @transactional
      tx() {
        return 'tx'
      }
      plain() {
        return 'plain'
      }
    }
    const { mgr, container } = wired()
    const m = container.resolve(Mixed)
    expect(await m.tx()).toBe('tx')
    expect(m.plain()).toBe('plain')
    expect(mgr.runs).toBe(1)
  })
})
