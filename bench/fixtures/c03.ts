import { controller, get } from 'turnover'

@controller('/bench03')
export class Bench03Controller {
  @get('/')
  index() {
    return { route: 'bench03' }
  }
}
