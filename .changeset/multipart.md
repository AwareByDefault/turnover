---
'turnover': minor
---

Add `multipart()` — parse `multipart/form-data` bodies into `{ fields, files }`,
readable through `ctx.body<MultipartBody>()` like any other body. Each upload is
an `UploadedFile` (field, filename, type, size, `bytes()`/`text()`). Enforces
optional `maxFiles`, `maxFileSize`, `maxTotalSize`, and `allowedTypes`
(exact or `image/*` wildcard) limits up front — using each file's known size
without buffering — rejecting violations with `400`/`413`/`415`.
