---
"turnover": minor
---

`@repository` now runs its methods in a transaction.

- **`@repository()`** is no longer just an alias for `@injectable`: every one of the class's own methods now runs inside the bound `TransactionManager` — committing on success, rolling back on a throw — as if each carried `@transactional`. Annotating a persistence component's intent earns the unit-of-work behavior; with no manager bound it stays a no-op.
- Explicit `@transactional` still works exactly as before, on any `@injectable`. `@service` remains a plain `@injectable` alias.
