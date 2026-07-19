import { controller, get } from 'turnover'

@controller('/bench02')
export class Bench02Controller {
  @get('/')
  index() {
    return { route: 'bench02' }
  }
}
