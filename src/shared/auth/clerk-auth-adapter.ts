import type { AuthAdapter } from './auth-adapter'
import { API_BASE_URL } from '../api-base'
import { CLERK_DOMAIN, CLERK_OAUTH_CLIENT_ID } from './providers'
import {
  readSession,
  writeSession,
  clearSession,
  isSessionTokenFresh,
  decodeJwtPayload,
  isTokenExpired,
  type StoredSession,
  type SessionExchangeResult,
} from './session-store'

// Clerk as an OAuth 2.0 / OIDC provider ("OAuth Applications" in the Clerk
// dashboard). The extension runs authorization-code + PKCE and hands the
// code to the backend, which does the token exchange (so a client secret,
// if the Clerk app is confidential, never touches the extension) and
// returns a ready backend session token.

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

/** Hands the authorization code to the backend, which exchanges it with
 * Clerk and returns a backend session token. */
async function exchangeCodeForSession(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<SessionExchangeResult | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri, codeVerifier }),
    })
    if (!response.ok) {
      console.error('[Claude Tools] Clerk code exchange returned', response.status)
      return null
    }
    const body = (await response.json()) as { sessionToken?: unknown; email?: unknown; expiresAt?: unknown }
    if (
      typeof body.sessionToken !== 'string' ||
      typeof body.email !== 'string' ||
      typeof body.expiresAt !== 'string'
    ) {
      return null
    }
    const expiresAt = Math.floor(new Date(body.expiresAt).getTime() / 1000)
    if (!Number.isFinite(expiresAt)) return null
    return { sessionToken: body.sessionToken, email: body.email, expiresAt }
  } catch (error) {
    console.error('[Claude Tools] Clerk code exchange failed', error)
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

    const exchanged = await exchangeCodeForSession(code, redirectUri, verifier)
    if (!exchanged) return null

    const session: StoredSession = {
      provider: 'clerk',
      email: exchanged.email,
      // No provider id_token is kept on the extension side for Clerk --
      // the backend session token is the only credential. `idToken` holds
      // the session token too so the fallback paths in getValidToken keep
      // working uniformly.
      idToken: exchanged.sessionToken,
      sessionToken: exchanged.sessionToken,
      sessionExpiresAt: exchanged.expiresAt,
    }
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

    // Session token near expiry / absent -- a silent re-auth gets a fresh
    // one from a still-live Clerk session cookie.
    const refreshed = await this.runAuthFlow(false)
    if (refreshed?.sessionToken) return refreshed.sessionToken

    // Offline fallback: the stored session token, if it hasn't hard-expired.
    if (session?.sessionToken) {
      const { exp } = decodeJwtPayload(session.sessionToken)
      if (!isTokenExpired(exp, now)) return session.sessionToken
    }

    await clearSession()
    return null
  }
}
