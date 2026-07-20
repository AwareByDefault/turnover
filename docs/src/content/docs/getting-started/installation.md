---
title: Installation
description: Add Turnover to a Bun project — no decorator compiler flags, no reflect-metadata, no configuration.
sidebar:
  order: 1
---

Turnover is a Bun-native package. Install it with Bun:

```bash
bun add turnover
```

That is the whole install. The core has **zero runtime dependencies** — the only peer
dependency is `@opentelemetry/api`, and it is optional (you only need it if you use the
[OpenTelemetry integration](/guides/opentelemetry/)).

## Requirements

- **[Bun](https://bun.sh) ≥ 1.0.0.** Turnover calls `Bun.serve`, `Bun.Glob`, `Bun.main`,
  and `Bun.file` directly, so `app.listen()` and controller auto-discovery need Bun. (The
  request pipeline itself is a standard `(Request) => Response` handler, so a Turnover app
  can also be [deployed to other WinterTC runtimes](/guides/deployment/).)
- **TypeScript with standard decorators.** Turnover uses the **standardized TC39
  decorators** built into TypeScript and Bun — *not* the legacy experimental ones.

## No decorator flags required

This is the part people expect to be hard and isn't. Turnover needs **none** of the usual
decorator ceremony:

- no `experimentalDecorators`
- no `emitDecoratorMetadata`
- no `reflect-metadata` import

It works under a default Bun/TypeScript setup. A minimal `tsconfig.json` looks like this:

```jsonc title="tsconfig.json"
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true
    // NO experimentalDecorators, NO emitDecoratorMetadata, NO reflect-metadata
  }
}
```

:::note[Why this matters]
Because Turnover uses standard decorators, there are **no parameter decorators** (the
standard doesn't have them). Dependency injection is done by calling `inject(Token)` in a
field initializer instead of decorating a constructor parameter — see
[Dependency injection](/concepts/dependency-injection/).
:::

## Importing

Turnover is **ESM-only**. Everything in the core is imported from the package root:

```ts
import { createApp, controller, get, inject } from "turnover";
```

A few features live on subpaths to keep the core dependency-free — for example
`turnover/otel` (OpenTelemetry), `turnover/bundler` (build-time plugin), and
`turnover/testing` (in-memory test client). Those are called out where they're used.

## Next steps

- [Quickstart](/getting-started/quickstart/) — define one route and serve it.
- [Your first API](/getting-started/your-first-api/) — build a small service with a
  controller, a service, validation, and error handling.
