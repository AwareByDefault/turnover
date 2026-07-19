import { controller, get } from 'turnover'

@controller('/bench10')
export class Bench10Controller {
  @get('/')
  index() {
    return { route: 'bench10' }
  }
}
