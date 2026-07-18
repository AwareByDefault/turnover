# Releasing turnover

turnover publishes to the public **npm registry** as the unscoped package
[`turnover`](https://www.npmjs.com/package/turnover). Releases are automated with
[Changesets](https://github.com/changesets/changesets): **no manual version bumps
and no manual `npm publish`**. `main` is the release branch.

The version is **decoupled from commit messages** — it comes from the changeset
file(s) a PR includes. `main` is squash-only.

## The model: a changeset per PR, publish on merge

1. **In your PR**, add a changeset declaring the release impact:

   ```bash
   bun run changeset      # interactive: pick patch / minor / major + a description
   ```

   This writes a file like `.changeset/cool-otters-sing.md`:

   ```md
   ---
   "turnover": minor
   ---

   Add a `@ws` decorator for WebSocket route handlers.
   ```

   | Level | When | Example |
   | --- | --- | --- |
   | `patch` | bug fix / internal change, no API change | `0.1.0` → `0.1.1` |
   | `minor` | backward-compatible new capability | `0.1.0` → `0.2.0` |
   | `major` | breaking change to the public API | `0.1.0` → `1.0.0` |

   For a change that should **not** release (docs, CI, tests, refactors), add an
   empty changeset instead — it satisfies the PR check without bumping anything:

   ```bash
   bun run changeset --empty
   ```

2. **A PR check enforces it.** The `Changeset present` CI job fails any PR that
   adds no `.changeset/*.md`, so release impact is always declared.

3. **On merge to `main`**, [`.github/workflows/release.yml`](../.github/workflows/release.yml)
   detects the pending changesets, runs the gate (`typecheck` + `build`), runs
   `changeset version` (bumps `package.json`, prepends `CHANGELOG.md`, deletes the
   consumed changesets), commits that back to `main` as `chore(release): version
   packages [skip ci]`, `changeset publish`es to npm, and cuts a **GitHub Release**
   for the new `v<version>` tag. A push carrying no changesets is a clean no-op; a
   push carrying **only empty** (no-release) changesets bumps nothing and publishes
   nothing, but still consumes them (`chore: consume empty changeset(s) [skip ci]`)
   so they don't retrigger the release on every later push.

## Branch protection: the release pushes as a GitHub App

The version commit + git tags push **directly to `main`**, which the `Protect
main` ruleset gates behind a PR. The release job therefore pushes as the
**`awarebydefault-release` GitHub App** — the ruleset's sole bypass actor — via a
short-lived token minted with `actions/create-github-app-token`. The built-in
`GITHUB_TOKEN` can't be a ruleset bypass actor, which is why the App exists (the
same App used by `display-case`).

One-time setup: install the App on this repo with **Contents: Read & write**, and
add its `RELEASE_APP_ID` + `RELEASE_APP_PRIVATE_KEY` as repo secrets.

## Publishing auth: OIDC trusted publishing (token-bootstrapped)

The package publishes with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) —
GitHub Actions authenticates to npm over OIDC, so no long-lived publish token
lives in the repo. `publishConfig.provenance = true` + the job's `id-token: write`
permission emit provenance attestations. The release job runs on **Node 24 with
npm ≥ 11.5.1** (both required for trusted publishing); `changeset publish` shells
out to that `npm` for the registry handshake.

npm can only configure a trusted publisher on a package that **already exists**,
so the rollout is two phases.

### Phase 1 — bootstrap the first release with a token

1. Mint an npm **Automation** (or granular, write-all) token — these bypass the
   account's 2FA/passkey-on-publish gate.
2. Add it as the **`NPM_TOKEN`** repo secret. When set, the release job writes a
   one-line `~/.npmrc` from it; when unset, the publish uses OIDC.
3. Merge a PR whose changeset takes `package.json` from `0.0.0` to `0.1.0`; the
   publish falls back to `NPM_TOKEN` and creates `turnover@0.1.0`.

### Phase 2 — switch to OIDC and delete the token

4. On **npmjs.com → the `turnover` package → Settings → Trusted Publisher**, add a
   GitHub Actions publisher:
   - **Organization or user:** `AwareByDefault`
   - **Repository:** `turnover`
   - **Workflow filename:** `release.yml` (filename only, not the path)
   - **Allowed actions:** `npm publish`
5. **Delete the `NPM_TOKEN` secret.** With it gone the job writes no `.npmrc` and
   `npm publish` uses OIDC tokenlessly. Confirm the run log shows the OIDC exchange
   succeeded.

## Inspecting

```bash
bun run changeset:status   # what would the pending changesets release?
```

If a release run fails **after** `changeset publish` succeeds but **before** the
push lands, npm has the new version while `main` lacks the bump. Re-run the
workflow (`workflow_dispatch`): `changeset publish` skips versions already on the
registry, the changesets are still on `main`, so the version + push are recreated
idempotently.
