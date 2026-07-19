import { controller, get } from 'turnover'

@controller('/bench09')
export class Bench09Controller {
  @get('/')
  index() {
    return { route: 'bench09' }
  }
}
