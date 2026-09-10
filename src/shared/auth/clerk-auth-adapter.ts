import type { AuthAdapter } from './auth-adapter'
import { CLERK_DOMAIN, CLERK_OAUTH_CLIENT_ID } from './providers'
import {
  readSession,
  writeSession,
  clearSession,
  isSessionTokenFresh,
  exchangeIdTokenForSession,
  decodeJwtPayload,
  isTokenExpired,
  type StoredSession,
} from './session-store'

// Clerk as an OAuth 2.0 / OIDC provider ("OAuth Applications" in the Clerk
// dashboard). Authorization-code + PKCE, public client -- no secret in the
// extension. The extension gets Clerk's id_token and trades it for a
// backend session token, exactly like the Google flow.

function base64url(bytes: ArrayBuffer): string {
  let binary = ''
  const view = new Uint8Array(bytes)
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface PkcePair {
  verifier: string
  challenge: string
}

export async function generatePkcePair(): Promise<PkcePair> {
  const random = new Uint8Array(32)
  crypto.getRandomValues(random)
  const verifier = base64url(random.buffer)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(digest) }
}

export function buildClerkAuthUrl(redirectUri: string, challenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLERK_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })
  return `https://${CLERK_DOMAIN}/oauth/authorize?${params.toString()}`
}

export function extractCodeFromRedirect(redirectUrl: string, expectedState: string): string | null {
  const queryIndex = redirectUrl.indexOf('?')
  if (queryIndex === -1) return null
  const params = new URLSearchParams(redirectUrl.slice(queryIndex + 1))
  if (params.get('state') !== expectedState) return null
  return params.get('code')
}

interface ClerkTokenResponse {
  id_token?: unknown
  access_token?: unknown
}

async function exchangeCodeForIdToken(
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<string | null> {
  try {
    const response = await fetch(`https://${CLERK_DOMAIN}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: CLERK_OAUTH_CLIENT_ID,
        code_verifier: verifier,
      }).toString(),
    })
    if (!response.ok) {
      console.error('[Claude Tools] Clerk token endpoint returned', response.status)
      return null
    }
    const body = (await response.json()) as ClerkTokenResponse
    if (typeof body.id_token === 'string') return body.id_token
    if (typeof body.access_token === 'string') return body.access_token
    return null
  } catch (error) {
    console.error('[Claude Tools] Clerk token exchange failed', error)
    return null
  }
}

export class ClerkAuthAdapter implements AuthAdapter {
  private async runAuthFlow(interactive: boolean): Promise<StoredSession | null> {
    const redirectUri = chrome.identity.getRedirectURL()
    const { verifier, challenge } = await generatePkcePair()
    const state = crypto.randomUUID()
    const authUrl = buildClerkAuthUrl(redirectUri, challenge, state)

    let redirectUrl: string | undefined
    try {
      redirectUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive })
    } catch (error) {
      console.error('[Claude Tools] Clerk sign-in flow failed', error)
      return null
    }
    if (!redirectUrl) return null

    const code = extractCodeFromRedirect(redirectUrl, state)
    if (!code) return null

    const idToken = await exchangeCodeForIdToken(code, redirectUri, verifier)
    if (!idToken) return null

    const { email } = decodeJwtPayload(idToken)
    if (!email) return null

    const exchanged = await exchangeIdTokenForSession(idToken)
    const session: StoredSession = exchanged
      ? {
          provider: 'clerk',
          email: exchanged.email,
          idToken,
          sessionToken: exchanged.sessionToken,
          sessionExpiresAt: exchanged.expiresAt,
        }
      : { provider: 'clerk', email, idToken }
    await writeSession(session)
    return session
  }

  async signIn(): Promise<{ email: string; idToken: string } | null> {
    return this.runAuthFlow(true)
  }

  async signOut(): Promise<void> {
    await clearSession()
  }

  async getCurrentSession(): Promise<{ email: string } | null> {
    const session = await readSession()
    return session ? { email: session.email } : null
  }

  async getValidToken(): Promise<string | null> {
    const session = await readSession()
    const now = Math.floor(Date.now() / 1000)

    if (session?.sessionToken && isSessionTokenFresh(session.sessionExpiresAt, now)) {
      return session.sessionToken
    }

    const refreshed = await this.runAuthFlow(false)
    if (refreshed) return refreshed.sessionToken ?? refreshed.idToken

    if (session) {
      const { exp } = decodeJwtPayload(session.idToken)
      if (!isTokenExpired(exp, now)) return session.sessionToken ?? session.idToken
    }

    await clearSession()
    return null
  }
}
