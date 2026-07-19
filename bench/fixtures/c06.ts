import { controller, get } from 'turnover'

@controller('/bench06')
export class Bench06Controller {
  @get('/')
  index() {
    return { route: 'bench06' }
  }
}
