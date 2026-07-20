---
title: Configuration
description: Read typed config values, bind environment variables to validated classes, and gate mounting with profiles.
sidebar:
  order: 3
---

Turnover reads configuration from `Bun.env` by default, with typed accessors, an injectable
`Config`, environment-bound classes, and profiles for environment-specific mounting. There is
no config-file convention — everything flows through `createApp(options)` and the environment.

## Reading values

The `value()` helper reads a config value inside a field initializer, **coercing to the
fallback's type**:

```ts
import { value, requireValue } from "turnover";

class ServerSettings {
  private port = value("PORT", 3000);       // number  (Number(raw), NaN → fallback)
  private debug = value("DEBUG", false);    // boolean ("true" or "1" → true)
  private region = value("REGION", "us");   // string
  private secret = requireValue("SECRET");  // string, throws if missing
}
```

- `value(key)` with no fallback returns `string | undefined` (no coercion).
- `value(key, fallback)` coerces to the fallback's type: a **number** fallback parses the raw
  value (falling back on `NaN`); a **boolean** fallback is `true` only for `"true"` or `"1"`;
  a **string** fallback returns the raw value.
- `requireValue(key)` returns the raw string, or **throws** if the key is missing.

## Injecting `Config`

For programmatic access, inject the `Config` service:

```ts
import { Config, inject, injectable } from "turnover";

@injectable()
class FeatureFlags {
  private readonly config = inject(Config);
  get pageSize() { return this.config.get("PAGE_SIZE", 20); }  // coerced to number
  get apiKey()   { return this.config.require("API_KEY"); }    // throws if missing
  get hasRedis() { return this.config.has("REDIS_URL"); }      // boolean presence check
  get isDev()    { return this.config.hasProfile("dev"); }     // active-profile check
}
```

`Config.get` carries the same coercing overloads as `value()`; `require`, `has`, and
`hasProfile` round it out. Each call reads the source fresh, so a getter like `pageSize`
always reflects the current value rather than a snapshot taken at construction.

## Overriding the source

By default config comes from `Bun.env`. Override it with `createApp({ config })`, passing
either a plain object or a `ConfigSource`:

```ts title="server.ts"
const app = await createApp({
  controllers: [/* ... */],
  config: { PORT: "8080", DEBUG: "true" },   // a plain object …
});

// … or a custom ConfigSource:
// createApp({ config: { get: (k) => myStore[k], entries: () => Object.entries(myStore) } })
```

A `ConfigSource` implements `get(key)` (and, optionally, `entries()` for `@configProperties`
binding below).

## Profiles

Profiles gate which controllers and modules mount. Set the active profiles with
`createApp({ profiles })`, or from the environment: `TURNOVER_PROFILES` (comma-separated)
takes precedence, otherwise `NODE_ENV` supplies a single profile.

`@profile(...names)` mounts a controller or module only when **one of its names** is active. A
class with no `@profile` is always mounted.

```ts
import { profile, controller, get } from "turnover";

@profile("dev") @controller("/debug")
class DebugController {
  @get("/") dump() { return { ok: true }; } // mounted only when "dev" is active
}
```

```ts
const app = await createApp({ profiles: ["dev"], controllers: [DebugController] });
```

Read the active profiles at runtime with `Config.hasProfile("dev")`.

## Binding a config class

`@configProperties(schema, { prefix? })` binds environment variables to a class's fields by
naming convention and validates them through a [Standard Schema](https://standardschema.dev)
**at construction — fail-fast**. Each `SCREAMING_SNAKE_CASE` variable maps to its
`camelCase` field (`DATABASE_URL` → `databaseUrl`), the whole object is validated and coerced,
and the result is assigned onto the instance.

```ts title="settings.ts"
import { z } from "zod";
import { configProperties, inject, controller, get } from "turnover";

const EnvSchema = z.object({
  port: z.coerce.number().default(3000),
  databaseUrl: z.string().url(),
});

@configProperties(EnvSchema)
class Settings {
  port!: number;        // ← PORT
  databaseUrl!: string; // ← DATABASE_URL
}

@controller("/health")
class HealthController {
  private readonly settings = inject(Settings); // constructed once (singleton)
  @get("/") status() { return { port: this.settings.port }; }
}
```

- Inject `Settings` like any class — it's constructed once (singleton) and its fields hold
  the **validated** values.
- A bad or missing value fails at boot with a `ConfigValidationError` listing the offending
  Standard Schema issues.
- `prefix: "APP_"` binds only variables starting with `APP_`, stripping the prefix first
  (`APP_PORT` → `port`).

:::caution
`@configProperties` reads the whole source via `entries()`, so its source must support
enumeration (the default `Bun.env` source and a plain-object `config` both do). The schema
must validate **synchronously** — an async validator throws.
:::

## Next steps

- [Dependency injection](/concepts/dependency-injection/) — `Config` and `@configProperties` are container-managed like any service.
- [Validation](/concepts/validation/) — the same Standard Schema interface `@configProperties` uses for request input.
