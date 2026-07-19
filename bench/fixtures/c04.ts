import { controller, get } from 'turnover'

@controller('/bench04')
export class Bench04Controller {
  @get('/')
  index() {
    return { route: 'bench04' }
  }
}
