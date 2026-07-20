import { createHash, randomBytes } from 'node:crypto'

/** The subset of `fetch` this client needs — injectable for tests. */
export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

/**
 * How the client sends its secret to the token endpoint: `body` puts
 * `client_secret` in the form body, `basic` sends it as an HTTP Basic
 * `Authorization` header (`client_secret_basic`).
 */
export type ClientAuthMethod = 'body' | 'basic'

/** Configuration for an {@link OAuth2Client}. */
export interface OAuth2Config {
  /** The client identifier registered with the provider. */
  clientId: string
  /** Required for confidential clients; omit for public (PKCE-only) clients. */
  clientSecret?: string
  /** Full URL of the provider's authorization endpoint; the base of the login URL built by {@link OAuth2Client.createAuthorizationUrl}. */
  authorizationEndpoint: string
  /** Full URL of the provider's token endpoint; `POST`ed server-to-server for code exchange and refresh. */
  tokenEndpoint: string
  /** Callback URL the provider redirects back to with the code; must exactly match one registered with the provider, and is re-sent on {@link OAuth2Client.exchangeCode}. */
  redirectUri: string
  /** Default scopes requested by {@link OAuth2Client.createAuthorizationUrl} (overridable per call); include `openid` to receive an {@link TokenResponse.idToken}. */
  scopes?: string[]
  /** How to send {@link OAuth2Config.clientSecret} (default `"body"`); irrelevant for public clients that have no secret. */
  clientAuth?: ClientAuthMethod
  /** Injected `fetch` (default the global). */
  fetch?: FetchLike
}

/** The result of {@link OAuth2Client.createAuthorizationUrl}. */
export interface AuthorizationRequest {
  /** The URL to redirect the user to. */
  url: string
  /** CSRF token — persist it and compare on callback. */
  state: string
  /** PKCE verifier — persist it and pass it to {@link OAuth2Client.exchangeCode}. */
  codeVerifier: string
}

/** A token endpoint response, normalized from the provider's snake_case JSON into camelCase (the untouched original stays in {@link TokenResponse.raw}). */
export interface TokenResponse {
  /** The access token to call APIs with. */
  accessToken: string
  /** The token type, typically `"Bearer"`. */
  tokenType: string
  /** Access-token lifetime in seconds, if the provider returned one. */
  expiresIn?: number
  /** Refresh token for {@link OAuth2Client.refreshToken}, if issued. */
  refreshToken?: string
  /** OIDC ID token (a JWT), if the `openid` scope was granted. */
  idToken?: string
  /** Scopes actually granted, space-delimited; may be narrower than requested, so check it before assuming access. */
  scope?: string
  /** The raw JSON, for provider-specific fields. */
  raw: Record<string, unknown>
}

/** Thrown when the token or userinfo endpoint responds with a non-2xx status. */
export class OAuth2Error extends Error {
  /** Construct an error for a failed token or userinfo request. */
  constructor(
    message: string,
    /** HTTP status returned by the endpoint. */
    readonly status: number,
    /** Parsed error body (or raw text) from the endpoint, for diagnostics. */
    readonly details: unknown,
  ) {
    super(message)
    this.name = 'OAuth2Error'
  }
}

function base64url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function randomToken(): string {
  return base64url(randomBytes(32))
}

function parseTokenResponse(json: Record<string, unknown>): TokenResponse {
  return {
    accessToken: String(json.access_token ?? ''),
    tokenType: String(json.token_type ?? 'Bearer'),
    expiresIn:
      typeof json.expires_in === 'number' ? json.expires_in : undefined,
    refreshToken:
      typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
    idToken: typeof json.id_token === 'string' ? json.id_token : undefined,
    scope: typeof json.scope === 'string' ? json.scope : undefined,
    raw: json,
  }
}

/**
 * A minimal OAuth 2.0 / OIDC authorization-code client with PKCE — the basis for
 * social and enterprise sign-in. Endpoints are configured generically, so it
 * works with any conformant provider. Build a login URL with
 * {@link OAuth2Client.createAuthorizationUrl} (persist the returned `state` and
 * `codeVerifier`), then swap the returned code for tokens with
 * {@link OAuth2Client.exchangeCode}. Dependency-free — network calls go through
 * the global `fetch` (or an injected one).
 *
 * ```ts
 * const client = new OAuth2Client({ clientId, clientSecret, authorizationEndpoint,
 *   tokenEndpoint, redirectUri, scopes: ['openid', 'email'] })
 * const { url, state, codeVerifier } = client.createAuthorizationUrl()
 * // redirect to `url`; on callback verify `state`, then:
 * const tokens = await client.exchangeCode({ code, codeVerifier })
 * ```
 */
export class OAuth2Client {
  private readonly fetch: FetchLike

  /** Create a client for the given provider configuration. */
  constructor(private readonly config: OAuth2Config) {
    this.fetch = config.fetch ?? ((input, init) => fetch(input, init))
  }

  /**
   * Build an authorization URL with a fresh `state` and PKCE challenge.
   *
   * @param options - overrides the config `scopes`, or pins `state`/`codeVerifier` (both default to fresh 256-bit random tokens — pin only for tests); `params` adds extra query parameters such as `prompt` or `login_hint`.
   */
  createAuthorizationUrl(
    options: {
      scopes?: string[]
      state?: string
      codeVerifier?: string
      params?: Record<string, string>
    } = {},
  ): AuthorizationRequest {
    const state = options.state ?? randomToken()
    const codeVerifier = options.codeVerifier ?? randomToken()
    const codeChallenge = base64url(
      createHash('sha256').update(codeVerifier).digest(),
    )
    const url = new URL(this.config.authorizationEndpoint)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', this.config.clientId)
    url.searchParams.set('redirect_uri', this.config.redirectUri)
    const scopes = options.scopes ?? this.config.scopes ?? []
    if (scopes.length > 0) url.searchParams.set('scope', scopes.join(' '))
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    for (const [key, value] of Object.entries(options.params ?? {})) {
      url.searchParams.set(key, value)
    }
    return { url: url.toString(), state, codeVerifier }
  }

  /**
   * Exchange an authorization `code` (plus its PKCE verifier) for tokens.
   * Throws {@link OAuth2Error} if the endpoint replies non-2xx.
   *
   * @param options - the authorization `code` from the callback, the `codeVerifier` you persisted alongside its `state` (required to satisfy PKCE), and a `redirectUri` override that must match the one originally sent.
   */
  exchangeCode(options: {
    code: string
    codeVerifier?: string
    redirectUri?: string
  }): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: options.code,
      redirect_uri: options.redirectUri ?? this.config.redirectUri,
      client_id: this.config.clientId,
    })
    if (options.codeVerifier) body.set('code_verifier', options.codeVerifier)
    return this.tokenRequest(body)
  }

  /**
   * Exchange a refresh token for a fresh access token.
   *
   * @param refreshToken - a refresh token from a prior {@link TokenResponse}; some providers rotate it and return a new one, so persist the response's `refreshToken` if present.
   * @returns The refreshed token set (throws {@link OAuth2Error} on a non-2xx response).
   */
  refreshToken(refreshToken: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
    })
    return this.tokenRequest(body)
  }

  /**
   * Fetch the OIDC userinfo profile with an access token.
   *
   * @typeParam T - the expected shape of the userinfo JSON; unchecked, so validate it if the source is untrusted.
   * @param accessToken - a valid access token, sent as a `Bearer` credential in the `Authorization` header.
   * @param userInfoEndpoint - the provider's userinfo endpoint (kept out of {@link OAuth2Config} since it is per-provider; read it from the OIDC discovery document).
   * @returns The parsed userinfo profile; throws {@link OAuth2Error} on a non-2xx response.
   */
  async fetchUserInfo<T = Record<string, unknown>>(
    accessToken: string,
    userInfoEndpoint: string,
  ): Promise<T> {
    const response = await this.fetch(userInfoEndpoint, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
    })
    if (!response.ok) {
      throw new OAuth2Error(
        `Userinfo request failed with ${response.status}.`,
        response.status,
        await response.text().catch(() => undefined),
      )
    }
    return (await response.json()) as T
  }

  private async tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    }
    if (this.config.clientSecret) {
      if ((this.config.clientAuth ?? 'body') === 'basic') {
        const credentials = `${this.config.clientId}:${this.config.clientSecret}`
        headers.authorization = `Basic ${Buffer.from(credentials).toString('base64')}`
      } else {
        body.set('client_secret', this.config.clientSecret)
      }
    }
    const response = await this.fetch(this.config.tokenEndpoint, {
      method: 'POST',
      headers,
      body,
    })
    const json = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >
    if (!response.ok) {
      const description =
        (typeof json.error_description === 'string' &&
          json.error_description) ||
        (typeof json.error === 'string' && json.error) ||
        `Token request failed with ${response.status}.`
      throw new OAuth2Error(description, response.status, json)
    }
    return parseTokenResponse(json)
  }
}
