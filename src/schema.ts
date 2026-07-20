/**
 * Schema validation via the {@link https://standardschema.dev Standard Schema}
 * interface. Any validator that implements it — Zod, Valibot, ArkType, TypeBox
 * (with its adapter), etc. — can be used to validate a route's `body`, `query`,
 * `params`, and `response` without turnover depending on any of them.
 *
 * The `StandardSchemaV1` types below are a structural copy of the spec (v1), as
 * the spec recommends, so no runtime dependency is pulled in.
 */

/**
 * A validator implementing the Standard Schema v1 interface — the only shape
 * turnover requires of a schema, so any conforming library is accepted without
 * an import. Used wherever a route or config declares input/output schemas.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The spec's single tilde-prefixed key (chosen to avoid colliding with a library's own fields). */
  readonly '~standard': StandardSchemaProps<Input, Output>
}

/** The object under the `'~standard'` key: version, vendor, and the `validate` entry point. */
export interface StandardSchemaProps<Input = unknown, Output = Input> {
  /** The version of the Standard Schema (always `1`). */
  readonly version: 1
  /** The name of the schema library (e.g. `'zod'`). */
  readonly vendor: string
  /** The sole runtime entry point turnover calls; may be sync or async, and never throws — it reports failure as `issues`. */
  readonly validate: (
    value: unknown,
  ) => StandardResult<Output> | Promise<StandardResult<Output>>
  /** Inference-only carrier of the schema's input and output types. */
  readonly types?: StandardTypes<Input, Output> | undefined
}

/** The result of validation: {@link StandardSuccess} or {@link StandardFailure}. */
export type StandardResult<Output> = StandardSuccess<Output> | StandardFailure

/** A successful validation result. */
export interface StandardSuccess<Output> {
  /** The validated (and possibly transformed) value. */
  readonly value: Output
  /** Always `undefined` on success (discriminates the result union). */
  readonly issues?: undefined
}

/** A failed validation result. */
export interface StandardFailure {
  /** The non-empty list of validation issues. */
  readonly issues: ReadonlyArray<StandardIssue>
}

/** A single validation issue. */
export interface StandardIssue {
  /** The human-readable error message; surfaced verbatim in the `422` response's `issues[].message`. */
  readonly message: string
  /** Location of the offending value, if applicable; segments may be bare keys or `{ key }` objects — {@link issuePath} normalizes both. */
  readonly path?: ReadonlyArray<PropertyKey | StandardPathSegment> | undefined
}

/** The object form of a {@link StandardIssue} path segment (some libraries emit bare `PropertyKey`s instead). */
export interface StandardPathSegment {
  /** The property key this segment points at. */
  readonly key: PropertyKey
}

/** The input and output types of a schema, present for inference only. */
export interface StandardTypes<Input = unknown, Output = Input> {
  /** The type accepted before validation/coercion (what a client sends). */
  readonly input: Input
  /** The type produced after validation/coercion (what lands on `ctx.valid`). */
  readonly output: Output
}

/** Infer the input type a schema accepts. */
export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
  Schema['~standard']['types']
>['input']

/** Infer the output type a schema produces after validation. */
export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
  Schema['~standard']['types']
>['output']

/**
 * Standard Schemas a route can declare for its inputs and output. Declared on a
 * route decorator's options (`@post("/", { body, query, params, response })`).
 * Inputs are validated after guards, in the order `params` → `query` → `body`;
 * an omitted field is not validated.
 */
export interface RouteSchemas {
  /**
   * Validates the parsed request body (checked last of the three inputs). The
   * coerced output lands on `ctx.valid.body`, while `ctx.body()` still returns
   * the raw body. A failure throws `422` with code `validation_failed`.
   */
  body?: StandardSchemaV1
  /**
   * Validates the query string after it is flattened to an object (repeated
   * keys become arrays). Coerced output lands on `ctx.valid.query`; a failure
   * throws `422` with code `validation_failed`.
   */
  query?: StandardSchemaV1
  /**
   * Validates the path params (checked first). Coerced output lands on
   * `ctx.valid.params`; a failure throws `422` with code `validation_failed`.
   */
  params?: StandardSchemaV1
  /**
   * Validates the handler's return value. Unlike the inputs, a mismatch is
   * treated as a server bug — it is logged and rendered as an opaque `500`,
   * never surfaced to the client as a `422`.
   */
  response?: StandardSchemaV1
}

/**
 * Validate `value` against a Standard Schema, awaiting the validator whether it
 * is sync or async. Unlike route input validation, this never throws — a
 * failure is returned as `{ issues }` for you to inspect, not raised as a `422`.
 *
 * @typeParam Schema - The Standard Schema being validated against; its `InferOutput` types the returned `value`.
 * @param schema - The Standard Schema to validate against.
 * @param value - The unknown value to validate.
 * @returns The result: `{ value }` (coerced output) on success, or `{ issues }` on failure.
 */
export async function validate<Schema extends StandardSchemaV1>(
  schema: Schema,
  value: unknown,
): Promise<StandardResult<InferOutput<Schema>>> {
  return (await schema['~standard'].validate(value)) as StandardResult<
    InferOutput<Schema>
  >
}

/**
 * Normalize a {@link StandardIssue} path into a flat array of keys, collapsing
 * both segment forms the spec permits — bare `PropertyKey`s and `{ key }`
 * objects — to their key. This is the shape used in the `422` response's
 * `issues[].path`.
 *
 * @param issue - The validation issue whose (possibly mixed-form) path to normalize.
 * @returns The path as a flat array of keys, or `undefined` if the issue carries none.
 */
export function issuePath(
  issue: StandardIssue,
): Array<PropertyKey> | undefined {
  return issue.path?.map((seg) => (typeof seg === 'object' ? seg.key : seg))
}
