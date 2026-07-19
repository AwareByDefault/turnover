---
"turnover": minor
---

Expose `turnover/auth` and `turnover/request` as package subpaths so consumers can augment the framework's `Principal` and `RequestStore` interfaces the way a published package requires (`declare module "turnover/auth"`).

The framework source now lives directly under `src/` (was `src/framework/`), and the runnable demo moved to a top-level `example/` folder that is **not** part of the published package.
