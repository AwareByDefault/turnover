import { controller, get } from 'turnover'

@controller('/bench00')
export class Bench00Controller {
  @get('/')
  index() {
    return { route: 'bench00' }
  }
}
