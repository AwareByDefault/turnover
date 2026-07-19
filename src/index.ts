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
  type DocsOptions,
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
export {
  Auth,
  authenticated,
  authorize,
  type Principal,
  requireAuth,
  requireRole,
  requireScope,
} from './auth'
export {
  type ApiKeyOptions,
  type AuthScheme,
  apiKey,
  authentication,
  type BearerOptions,
  bearer,
} from './authentication'
export { bodyLimit } from './body-limit'
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
export { type CompressionOptions, compression } from './compression'
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
export { type CsrfOptions, csrf } from './csrf'
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
  type EnqueueOptions,
  type Job,
  type JobHandler,
  JobQueue,
  type JobQueueOptions,
  type JobStatus,
  type JobStore,
} from './jobs'
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
  type Address,
  type Mail,
  Mailer,
  type MailerOptions,
  type MailTransport,
  type MemoryTransport,
  memoryTransport,
  type OutgoingMail,
} from './mailer'
export {
  type Ctor,
  ctxMeta as decoratorMeta,
  type HttpMethod,
  type MetaBag,
  metadataOf as classMeta,
} from './metadata'
export {
  Counter,
  DEFAULT_BUCKETS,
  Gauge,
  Histogram,
  type Labels,
  type MetricsOptions,
  MetricsRegistry,
  metrics,
} from './metrics'
export { type ModuleOptions, module } from './module'
export {
  type MultipartBody,
  type MultipartOptions,
  multipart,
  UploadedFile,
} from './multipart'
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
export {
  PASSWORD_OPTIONS,
  type PasswordAlgorithm,
  PasswordHasher,
  type PasswordOptions,
} from './password'
export { type ProblemDocument, problemDetails } from './problem-details'
export {
  memoryRateLimitStore,
  type RateLimitOptions,
  type RateLimitStore,
  rateLimit,
} from './rate-limit'
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
  type SecurityHeadersOptions,
  securityHeaders,
} from './security-headers'
export {
  memorySessionStore,
  Session,
  type SessionData,
  type SessionOptions,
  type SessionStore,
  session,
} from './session'
export {
  SseChannel,
  type SseEvent,
  type SseOptions,
  sse,
} from './sse'
export { type StaticOptions, serveStatic } from './static'
export {
  Totp,
  type TotpAlgorithm,
  type TotpOptions,
} from './totp'
export {
  TRANSACTION_MANAGER,
  type TransactionManager,
  transactional,
} from './transaction'
