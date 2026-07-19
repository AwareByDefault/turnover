---
---

CI: reformat `package.json` with Biome after `changeset version` in the release
pipeline, so the committed file matches `lint` and feature branches no longer
inherit a spurious `package.json` diff. No package change.
