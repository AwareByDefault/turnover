---
'turnover': minor
---

`@repository` is now transactional by default: every instance method runs inside
the bound `TransactionManager` (commit on success, roll back on throw), so a DAO
is a unit of work without annotating each method. To avoid making every data
call async when transactions aren't configured, `@transactional`/`@repository`
now pass through unchanged when no manager is bound — a synchronous method stays
synchronous. Once a `TransactionManager` is bound, those methods run in it and
return promises (breaking, but only for apps that opt into transactions; allowed
pre-1.0). Use `@service`/`@injectable` for a non-transactional component.
