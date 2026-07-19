import { controller, get } from 'turnover'

@controller('/bench05')
export class Bench05Controller {
  @get('/')
  index() {
    return { route: 'bench05' }
  }
}
