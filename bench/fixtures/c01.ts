import { controller, get } from 'turnover'

@controller('/bench01')
export class Bench01Controller {
  @get('/')
  index() {
    return { route: 'bench01' }
  }
}
