import { controller, get } from 'turnover'

@controller('/bench08')
export class Bench08Controller {
  @get('/')
  index() {
    return { route: 'bench08' }
  }
}
