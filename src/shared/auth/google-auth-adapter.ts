import type { AuthAdapter } from './auth-adapter'
import { GOOGLE_CLIENT_ID } from './providers'
import {
  readSession,
  writeSession,
  clearSession,
  isSessionTokenFresh,
  exchangeIdTokenForSession,
  decodeJwtPayload,
  isTokenExpired,
  type StoredSession,
  type SessionExchangeResult,
} from './session-store'

// Re-exports kept so existing imports (and tests) still resolve.
export { isSessionTokenFresh, exchangeIdTokenForSession, isTokenExpired }
export type { SessionExchangeResult }
export const decodeIdToken = decodeJwtPayload
export type DecodedIdToken = ReturnType<typeof decodeJwtPayload>

export function buildGoogleAuthUrl(redirectUri: string, nonce: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    response_type: 'id_token',
    redirect_uri: redirectUri,
    scope: 'openid email',
    nonce,
    prompt: 'select_account',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export function extractIdTokenFromRedirect(redirectUrl: string): string | null {
  const hashIndex = redirectUrl.indexOf('#')
  if (hashIndex === -1) return null
  const params = new URLSearchParams(redirectUrl.slice(hashIndex + 1))
  return params.get('id_token')
}

export class GoogleAuthAdapter implements AuthAdapter {
  private async runAuthFlow(interactive: boolean): Promise<StoredSession | null> {
    const redirectUri = chrome.identity.getRedirectURL()
    const nonce = crypto.randomUUID()
    const authUrl = buildGoogleAuthUrl(redirectUri, nonce)

    let redirectUrl: string | undefined
    try {
      redirectUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive })
    } catch (error) {
      console.error('[Claude Tools] Google sign-in flow failed', error)
      return null
    }
    if (!redirectUrl) return null

    const idToken = extractIdTokenFromRedirect(redirectUrl)
    if (!idToken) return null

    const { email } = decodeJwtPayload(idToken)
    if (!email) return null

    const exchanged = await exchangeIdTokenForSession(idToken)
    const session: StoredSession = exchanged
      ? {
          provider: 'google',
          email: exchanged.email,
          idToken,
          sessionToken: exchanged.sessionToken,
          sessionExpiresAt: exchanged.expiresAt,
        }
      : { provider: 'google', email, idToken }
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
