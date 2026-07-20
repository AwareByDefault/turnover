# Turnover documentation site

The documentation site for [Turnover](https://github.com/AwareByDefault/turnover), built
with [Astro](https://astro.build) + [Starlight](https://starlight.astro.build).

Content lives in `src/content/docs/`, organized into four sections:

- `getting-started/` — install, quickstart, and a build-your-first-API tutorial.
- `concepts/` — how the framework works (routing, DI, the request lifecycle, validation,
  errors, and the rest of the core).
- `guides/` — task-focused how-tos (testing, OpenAPI, deployment, OpenTelemetry, …).
- `reference/` — the public API surface and the larger production-module set.

The sidebar is generated from these directories; per-page order is set with each page's
`sidebar.order` frontmatter. Site config (title, social links, sidebar groups) is in
`astro.config.mjs`.

## Commands

Run from this `docs/` directory:

| Command         | Action                                          |
| :-------------- | :---------------------------------------------- |
| `bun install`   | Install dependencies                            |
| `bun run dev`   | Start the local dev server                      |
| `bun run build` | Build the production site to `./dist/`          |
| `bun run preview` | Preview the production build locally          |

## Writing docs

- Pages are Starlight Markdown (`.md`). Every claim should match the framework **source**
  in `../src/` — the source is the source of truth.
- Give each page `title`, `description`, and `sidebar.order` frontmatter, and end it with a
  "Next steps" links section.
