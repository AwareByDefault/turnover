import { createHash, randomBytes } from 'node:crypto'

/** The subset of `fetch` this client needs — injectable for tests. */
export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

/** How the client authenticates to the token endpoint. */
export type ClientAuthMethod = 'body' | 'basic'

/** Configuration for an {@link OAuth2Client}. */
export interface OAuth2Config {
  clientId: string
  /** Required for confidential clients; omit for public (PKCE-only) clients. */
  clientSecret?: string
  /** The provider's authorization endpoint. */
  authorizationEndpoint: string
  /** The provider's token endpoint. */
  tokenEndpoint: string
  /** Where the provider redirects back with the code. */
  redirectUri: string
  /** Default scopes for {@link OAuth2Client.createAuthorizationUrl}. */
  scopes?: string[]
  /** How to send the client secret (default `"body"`). */
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

/** A normalized token endpoint response. */
export interface TokenResponse {
  accessToken: string
  tokenType: string
  expiresIn?: number
  refreshToken?: string
  idToken?: string
  scope?: string
  /** The raw JSON, for provider-specific fields. */
  raw: Record<string, unknown>
}

/** Thrown when the token endpoint responds with a non-2xx status. */
export class OAuth2Error extends Error {
  constructor(
    message: string,
    readonly status: number,
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

  constructor(private readonly config: OAuth2Config) {
    this.fetch = config.fetch ?? ((input, init) => fetch(input, init))
  }

  /** Build an authorization URL with a fresh `state` and PKCE challenge. */
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

  /** Exchange an authorization `code` (plus its PKCE verifier) for tokens. */
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

  /** Exchange a refresh token for a fresh access token. */
  refreshToken(refreshToken: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
    })
    return this.tokenRequest(body)
  }

  /** Fetch the OIDC userinfo profile with an access token. */
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
