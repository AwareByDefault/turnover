// Public API of the framework.

export {
  type AfterAdvice,
  type AroundAdvice,
  addAround,
  after,
  around,
  aspectProcessor,
  type BeforeAdvice,
  before,
  type JoinPoint,
  type ProceedingJoinPoint,
} from './aop'
export {
  type AfterResponseHook,
  App,
  type BodyParser,
  type CreateAppOptions,
  createApp,
  type FetchHandler,
  type ListenOptions,
  type Plugin,
  type RequestHook,
  type ResponseHook,
  type ResponseSerializer,
  type StartHook,
  type StopHook,
  type TraceEvent,
  type TraceHook,
} from './app'
export { Auth, type Principal, requireAuth } from './auth'
export {
  CACHE_STORE,
  type CacheableOptions,
  type CacheStore,
  cacheable,
  cacheEvict,
  MemoryCache,
} from './cache'
export {
  type Client,
  type ClientConfig,
  type ClientResult,
  createClient,
} from './client'
export {
  ACTIVE_PROFILES,
  CONFIG_SOURCE,
  Config,
  type ConfigPropertiesOptions,
  type ConfigSource,
  ConfigValidationError,
  configProperties,
  EnvConfigSource,
  profile,
  requireValue,
  value,
} from './config'
export { type CookieOptions, Cookies } from './cookies'
export { type CorsOptions, cors } from './cors'
export {
  Container,
  InjectionToken,
  inject,
  injectAll,
  injectable,
  injectOptional,
  type PostProcessor,
  type Provider,
  type ProviderDef,
  postConstruct,
  preDestroy,
  repository,
  type Scope,
  service,
  type Token,
} from './di'
export {
  BadRequestError,
  ConflictError,
  type ErrorBody,
  ForbiddenError,
  GoneError,
  HttpError,
  type HttpErrorOptions,
  InternalServerError,
  NotFoundError,
  PaymentRequiredError,
  TooManyRequestsError,
  toErrorResponse,
  UnauthorizedError,
  UnprocessableEntityError,
} from './error'
export { type EtagOptions, etag } from './etag'
export {
  type EventListener,
  Events,
  type EventType,
  onEvent,
} from './events'
export { type HealthCheck, type HealthOptions, health } from './health'
export {
  type Context,
  catchError,
  controller,
  type Deriver,
  del,
  derive,
  type ErrorHandler,
  type Guard,
  get,
  type Interceptor,
  intercept,
  patch,
  post,
  put,
  type ResponseState,
  type RouteOptions,
  resolve,
  use,
  type ValidatedInputs,
} from './http'
export {
  LOG_LEVEL,
  LOG_SINK,
  Logger,
  type LogLevel,
  type LogRecord,
  type LogSink,
} from './logger'
export {
  defineMacro,
  type MacroFactory,
  type MacroHooks,
  macro,
} from './macro'
export {
  type Ctor,
  ctxMeta as decoratorMeta,
  type HttpMethod,
  type MetaBag,
  metadataOf as classMeta,
} from './metadata'
export { type ModuleOptions, module } from './module'
export type {
  OpenApiDocument,
  OpenApiInfo,
  OpenApiOptions,
  OpenApiServer,
  OperationMeta,
} from './openapi'
export {
  type Page,
  type PageOptions,
  type PageParams,
  pageParams,
  paginated,
} from './pagination'
export { type ProblemDocument, problemDetails } from './problem-details'
export {
  getRequestId,
  getRequestState,
  getRequestStore,
  type RequestState,
  type RequestStore,
  setPrincipal,
  setRequestId,
} from './request'
export { type RequestIdOptions, requestId } from './request-id'
export {
  type ScheduledOptions,
  Scheduler,
  scheduled,
  schedulingProcessor,
} from './scheduling'
export {
  type InferInput,
  type InferOutput,
  issuePath,
  type RouteSchemas,
  type StandardFailure,
  type StandardIssue,
  type StandardResult,
  type StandardSchemaV1,
  type StandardSuccess,
  validate,
} from './schema'
export {
  TRANSACTION_MANAGER,
  type TransactionManager,
  transactional,
} from './transaction'
