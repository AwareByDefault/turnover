import { injectable } from 'turnover'

/**
 * A singleton service. The `count` persists across requests, which demonstrates
 * that the same instance is injected everywhere (singleton scope, the default).
 */
@injectable()
export class GreetingService {
  private count = 0

  greet(name: string): string {
    this.count += 1
    return `Hello, ${name}! (greeting #${this.count})`
  }
}
