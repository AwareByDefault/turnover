import { controller, get } from 'turnover'

@controller('/bench07')
export class Bench07Controller {
  @get('/')
  index() {
    return { route: 'bench07' }
  }
}
