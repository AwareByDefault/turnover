import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { type FetchLike, OAuth2Client, OAuth2Error } from '../src'

interface Call {
  url: string
  init?: RequestInit
}

function mockFetch(
  responder: (url: string, init?: RequestInit) => Response,
): FetchLike & { calls: Call[] } {
  const calls: Call[] = []
  const fn: FetchLike = async (url, init) => {
    calls.push({ url: String(url), init })
    return responder(String(url), init)
  }
  return Object.assign(fn, { calls })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const base = {
  clientId: 'client-123',
  authorizationEndpoint: 'https://idp.example/authorize',
  tokenEndpoint: 'https://idp.example/token',
  redirectUri: 'https://app.example/callback',
}

function bodyParams(init?: RequestInit): URLSearchParams {
  return init?.body as URLSearchParams
}

describe('OAuth2Client', () => {
  test('builds an authorization URL with state and a PKCE S256 challenge', () => {
    const client = new OAuth2Client({ ...base, scopes: ['openid', 'email'] })
    const { url, state, codeVerifier } = client.createAuthorizationUrl()
    const parsed = new URL(url)

    expect(parsed.origin + parsed.pathname).toBe(
      'https://idp.example/authorize',
    )
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('client_id')).toBe('client-123')
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://app.example/callback',
    )
    expect(parsed.searchParams.get('scope')).toBe('openid email')
    expect(parsed.searchParams.get('state')).toBe(state)
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')

    // The challenge must be base64url(sha256(verifier)).
    const expected = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url')
    expect(parsed.searchParams.get('code_challenge')).toBe(expected)
  })

  test('exchanges a code for tokens with PKCE', async () => {
    const fetch = mockFetch(() =>
      jsonResponse({
        access_token: 'at',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'rt',
        id_token: 'idt',
        scope: 'openid',
      }),
    )
    const client = new OAuth2Client({ ...base, fetch })
    const tokens = await client.exchangeCode({
      code: 'auth-code',
      codeVerifier: 'verifier',
    })

    expect(fetch.calls[0]?.url).toBe('https://idp.example/token')
    expect(fetch.calls[0]?.init?.method).toBe('POST')
    const body = bodyParams(fetch.calls[0]?.init)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('auth-code')
    expect(body.get('code_verifier')).toBe('verifier')
    expect(body.get('redirect_uri')).toBe('https://app.example/callback')
    expect(body.get('client_id')).toBe('client-123')

    expect(tokens.accessToken).toBe('at')
    expect(tokens.refreshToken).toBe('rt')
    expect(tokens.idToken).toBe('idt')
    expect(tokens.expiresIn).toBe(3600)
  })

  test('sends the client secret in the body by default', async () => {
    const fetch = mockFetch(() => jsonResponse({ access_token: 'at' }))
    const client = new OAuth2Client({ ...base, clientSecret: 'shh', fetch })
    await client.exchangeCode({ code: 'c' })
    expect(bodyParams(fetch.calls[0]?.init).get('client_secret')).toBe('shh')
  })

  test('sends the client secret as HTTP Basic when configured', async () => {
    const fetch = mockFetch(() => jsonResponse({ access_token: 'at' }))
    const client = new OAuth2Client({
      ...base,
      clientSecret: 'shh',
      clientAuth: 'basic',
      fetch,
    })
    await client.exchangeCode({ code: 'c' })
    const headers = fetch.calls[0]?.init?.headers as
      | Record<string, string>
      | undefined
    expect(headers?.authorization).toBe(
      `Basic ${Buffer.from('client-123:shh').toString('base64')}`,
    )
    // The secret must not also appear in the body.
    expect(bodyParams(fetch.calls[0]?.init).get('client_secret')).toBeNull()
  })

  test('refreshes an access token', async () => {
    const fetch = mockFetch(() =>
      jsonResponse({ access_token: 'new', token_type: 'Bearer' }),
    )
    const client = new OAuth2Client({ ...base, fetch })
    const tokens = await client.refreshToken('rt')
    const body = bodyParams(fetch.calls[0]?.init)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('rt')
    expect(tokens.accessToken).toBe('new')
  })

  test('throws OAuth2Error on a non-2xx token response', async () => {
    const fetch = mockFetch(() =>
      jsonResponse(
        { error: 'invalid_grant', error_description: 'bad code' },
        400,
      ),
    )
    const client = new OAuth2Client({ ...base, fetch })
    const error = await client
      .exchangeCode({ code: 'nope' })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(OAuth2Error)
    expect((error as OAuth2Error).status).toBe(400)
    expect((error as OAuth2Error).message).toBe('bad code')
  })

  test('fetches the OIDC userinfo profile with a bearer token', async () => {
    const fetch = mockFetch(() => jsonResponse({ sub: '42', email: 'a@b.io' }))
    const client = new OAuth2Client({ ...base, fetch })
    const profile = await client.fetchUserInfo<{ sub: string; email: string }>(
      'access-token',
      'https://idp.example/userinfo',
    )
    const headers = fetch.calls[0]?.init?.headers as
      | Record<string, string>
      | undefined
    expect(headers?.authorization).toBe('Bearer access-token')
    expect(profile).toEqual({ sub: '42', email: 'a@b.io' })
  })
})
