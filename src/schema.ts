/**
 * Schema validation via the {@link https://standardschema.dev Standard Schema}
 * interface. Any validator that implements it — Zod, Valibot, ArkType, TypeBox
 * (with its adapter), etc. — can be used to validate a route's `body`, `query`,
 * `params`, and `response` without turnover depending on any of them.
 *
 * The `StandardSchemaV1` types below are a structural copy of the spec (v1), as
 * the spec recommends, so no runtime dependency is pulled in.
 */

/** A validator implementing the Standard Schema v1 interface. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The Standard Schema properties (the interface's sole property). */
  readonly '~standard': StandardSchemaProps<Input, Output>
}

/** The properties that implement the Standard Schema interface. */
export interface StandardSchemaProps<Input = unknown, Output = Input> {
  /** The version of the Standard Schema (always `1`). */
  readonly version: 1
  /** The name of the schema library (e.g. `'zod'`). */
  readonly vendor: string
  /** Validate an unknown value, returning the result (may be async). */
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
  /** The human-readable error message. */
  readonly message: string
  /** The path to the offending value, if applicable. */
  readonly path?: ReadonlyArray<PropertyKey | StandardPathSegment> | undefined
}

/** A single segment of a {@link StandardIssue} path. */
export interface StandardPathSegment {
  /** The key of this path segment. */
  readonly key: PropertyKey
}

/** The input and output types of a schema, present for inference only. */
export interface StandardTypes<Input = unknown, Output = Input> {
  /** The type accepted as input. */
  readonly input: Input
  /** The type produced after validation. */
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

/** Standard Schemas a route can declare for its inputs and output. */
export interface RouteSchemas {
  /** Schema for the request body. */
  body?: StandardSchemaV1
  /** Schema for the query-string parameters. */
  query?: StandardSchemaV1
  /** Schema for the path parameters. */
  params?: StandardSchemaV1
  /** Schema for the response body. */
  response?: StandardSchemaV1
}

/**
 * Validate `value` against a Standard Schema, awaiting an async validator. The
 * result is `{ value }` on success or `{ issues }` on failure.
 *
 * @typeParam Schema - The Standard Schema type validating the value.
 * @param schema - The Standard Schema to validate against.
 * @param value - The unknown value to validate.
 * @returns The result: `{ value }` on success or `{ issues }` on failure.
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
 * Normalize a Standard Schema issue's path into a plain array of keys.
 *
 * @param issue - The validation issue whose path to normalize.
 * @returns The path as a flat array of keys, or `undefined` if the issue has none.
 */
export function issuePath(
  issue: StandardIssue,
): Array<PropertyKey> | undefined {
  return issue.path?.map((seg) => (typeof seg === 'object' ? seg.key : seg))
}
