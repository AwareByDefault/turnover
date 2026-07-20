import type { BodyParser, Plugin } from './app'
import { HttpError } from './error'

/**
 * One uploaded file from a `multipart/form-data` body. Wraps the web `File`
 * with the originating field name and convenience readers; `size`/`type` are
 * available without reading the contents.
 */
export class UploadedFile {
  constructor(
    /** The form field this file arrived under. */
    readonly field: string,
    private readonly file: File,
  ) {}

  /** The client-supplied filename — untrusted; sanitize before using it as a filesystem path. May be empty. */
  get filename(): string {
    return this.file.name
  }
  /** The client-declared MIME type (the part's `Content-Type`), not sniffed from the bytes — treat it as a hint, not a guarantee. */
  get type(): string {
    return this.file.type
  }
  /** Size in bytes. */
  get size(): number {
    return this.file.size
  }
  /** The underlying web `File` (for streaming or passing through). */
  get blob(): File {
    return this.file
  }

  /**
   * Read the entire file into memory as bytes. The upload is already fully in
   * memory (the whole body was buffered by `req.formData()` during parsing), so
   * this only copies it into a `Uint8Array`; use {@link UploadedFile.blob} to
   * pass the `File` through without the extra copy.
   *
   * @returns the full contents as a `Uint8Array`
   */
  async bytes(): Promise<Uint8Array> {
    return new Uint8Array(await this.file.arrayBuffer())
  }
  /**
   * Read the entire file into memory and decode it as UTF-8 text.
   *
   * @returns the file's contents decoded as a string
   */
  text(): Promise<string> {
    return this.file.text()
  }
}

/** The parsed shape of a `multipart/form-data` body (via `ctx.body()`). */
export interface MultipartBody {
  /** Non-file form fields. Repeated names keep the last value. */
  fields: Record<string, string>
  /** Uploaded files grouped by field name. */
  files: Record<string, UploadedFile[]>
}

/** Options for {@link multipart}. */
export interface MultipartOptions {
  /** Reject once more than this many files arrive (`400`). */
  maxFiles?: number
  /** Reject any single file larger than this many bytes (`413`). */
  maxFileSize?: number
  /** Reject once the combined file size exceeds this many bytes (`413`). */
  maxTotalSize?: number
  /**
   * Allowed MIME types (`415` otherwise). Exact (`"image/png"`) or a subtype
   * wildcard (`"image/*"`).
   */
  allowedTypes?: string[]
}

function typeAllowed(type: string, allowed: string[]): boolean {
  return allowed.some((pattern) =>
    pattern.endsWith('/*')
      ? type.startsWith(pattern.slice(0, -1))
      : type === pattern,
  )
}

/**
 * Plugin: parse `multipart/form-data` bodies into `{ fields, files }`, readable
 * through `ctx.body<MultipartBody>()` like any other body. `req.formData()`
 * first buffers the entire request body into memory; the optional
 * count/size/type limits then reject violations with `400`/`413`/`415` but do
 * not cap what is read into memory — that ceiling is Bun's `maxRequestBodySize`.
 *
 * ```ts
 * const app = await createApp({
 *   plugins: [multipart({ maxFileSize: 5_000_000, allowedTypes: ['image/*'] })],
 * })
 * // in a handler: const { fields, files } = await ctx.body<MultipartBody>()
 * ```
 *
 * @param options - optional count/size/type upload limits
 * @returns a plugin registering a `multipart/form-data` body parser
 */
export function multipart(options: MultipartOptions = {}): Plugin {
  const parse = async (req: Request): Promise<MultipartBody> => {
    const form = await req.formData()
    const fields: Record<string, string> = {}
    const files: Record<string, UploadedFile[]> = {}
    let fileCount = 0
    let totalSize = 0

    for (const [name, value] of form.entries()) {
      if (typeof value === 'string') {
        fields[name] = value
        continue
      }
      const file = value as File
      fileCount += 1
      if (options.maxFiles !== undefined && fileCount > options.maxFiles) {
        throw new HttpError(400, `Too many files (max ${options.maxFiles}).`)
      }
      if (
        options.maxFileSize !== undefined &&
        file.size > options.maxFileSize
      ) {
        throw new HttpError(
          413,
          `File "${file.name}" exceeds the ${options.maxFileSize}-byte limit.`,
        )
      }
      totalSize += file.size
      if (
        options.maxTotalSize !== undefined &&
        totalSize > options.maxTotalSize
      ) {
        throw new HttpError(
          413,
          `Upload exceeds the ${options.maxTotalSize}-byte total limit.`,
        )
      }
      if (
        options.allowedTypes &&
        !typeAllowed(file.type, options.allowedTypes)
      ) {
        throw new HttpError(415, `File type "${file.type}" is not allowed.`)
      }
      const list = files[name] ?? []
      list.push(new UploadedFile(name, file))
      files[name] = list
    }

    return { fields, files }
  }

  const parser: BodyParser = { contentTypes: ['multipart/form-data'], parse }
  return { parsers: [parser] }
}
