import { controller, get } from 'turnover'

@controller('/bench11')
export class Bench11Controller {
  @get('/')
  index() {
    return { route: 'bench11' }
  }
}
