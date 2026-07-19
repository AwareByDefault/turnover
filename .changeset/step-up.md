---
'turnover': minor
---

Add step-up authentication and impersonation helpers over `session()`.
`requireStepUp({ within })` is a guard that gates a sensitive route behind recent
re-authentication (401 otherwise); mark a fresh re-auth with `elevate()` and
inspect it with `elevationAge()`/`clearElevation()`. For privileged access,
`impersonate()`/`getImpersonation()`/`stopImpersonation()` record an actor acting
as another user while preserving the actor's own identity for audit and reversal.
