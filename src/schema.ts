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
  readonly '~standard': StandardSchemaProps<Input, Output>
}

export interface StandardSchemaProps<Input = unknown, Output = Input> {
  readonly version: 1
  readonly vendor: string
  readonly validate: (
    value: unknown,
  ) => StandardResult<Output> | Promise<StandardResult<Output>>
  readonly types?: StandardTypes<Input, Output> | undefined
}

export type StandardResult<Output> = StandardSuccess<Output> | StandardFailure

export interface StandardSuccess<Output> {
  readonly value: Output
  readonly issues?: undefined
}

export interface StandardFailure {
  readonly issues: ReadonlyArray<StandardIssue>
}

export interface StandardIssue {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | StandardPathSegment> | undefined
}

export interface StandardPathSegment {
  readonly key: PropertyKey
}

export interface StandardTypes<Input = unknown, Output = Input> {
  readonly input: Input
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
  body?: StandardSchemaV1
  query?: StandardSchemaV1
  params?: StandardSchemaV1
  response?: StandardSchemaV1
}

/**
 * Validate `value` against a Standard Schema, awaiting an async validator. The
 * result is `{ value }` on success or `{ issues }` on failure.
 */
export async function validate<Schema extends StandardSchemaV1>(
  schema: Schema,
  value: unknown,
): Promise<StandardResult<InferOutput<Schema>>> {
  return (await schema['~standard'].validate(value)) as StandardResult<
    InferOutput<Schema>
  >
}

/** Normalize a Standard Schema issue's path into a plain array of keys. */
export function issuePath(
  issue: StandardIssue,
): Array<PropertyKey> | undefined {
  return issue.path?.map((seg) => (typeof seg === 'object' ? seg.key : seg))
}
