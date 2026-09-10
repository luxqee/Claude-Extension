import type { AuthAdapter } from './auth-adapter'
import { API_BASE_URL } from '../api-base'

const GOOGLE_CLIENT_ID = '14020508582-rsh9tk73lhm3c3ekki32mvfc9a2m3di6.apps.googleusercontent.com'
const SESSION_STORAGE_KEY = 'authSession'
const EXPIRY_SKEW_SECONDS = 60
/** Refresh the backend session token this many seconds before it expires,
 * so a call never goes out with a token about to lapse mid-flight. */
const SESSION_EXPIRY_SKEW_SECONDS = 5 * 60

interface StoredSession {
  email: string
  /** The most recent Google id_token. Kept so a session token can be
   * re-minted without a fresh interactive sign-in, and as a fallback the
   * backend still accepts directly. */
  idToken: string
  /** Backend-issued session JWT used for API calls once obtained. Absent
   * on sessions stored by builds before Phase 2, or when the exchange
   * call has not yet succeeded. */
  sessionToken?: string
  /** `sessionToken`'s expiry, seconds since epoch. */
  sessionExpiresAt?: number
}

export function isSessionTokenFresh(expiresAt: number | undefined, nowSeconds: number): boolean {
  if (typeof expiresAt !== 'number') return false
  return nowSeconds < expiresAt - SESSION_EXPIRY_SKEW_SECONDS
}

export interface SessionExchangeResult {
  sessionToken: string
  email: string
  /** seconds since epoch */
  expiresAt: number
}

/** Exchanges a Google id_token for a backend session token via
 * `POST /api/auth/session`. Returns null on any failure (network, non-2xx,
 * malformed body) -- callers fall back to the Google id_token. */
export async function exchangeIdTokenForSession(idToken: string): Promise<SessionExchangeResult | null> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/auth/session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    })
  } catch (error) {
    console.error('[Claude Tools] session-token exchange request failed', error)
    return null
  }
  if (!response.ok) {
    console.error('[Claude Tools] session-token exchange returned status', response.status)
    return null
  }
  let body: { sessionToken?: unknown; email?: unknown; expiresAt?: unknown }
  try {
    body = await response.json()
  } catch (error) {
    console.error('[Claude Tools] session-token exchange response was not JSON', error)
    return null
  }
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
}

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

export interface DecodedIdToken {
  email: string | null
  exp: number | null
}

export function decodeIdToken(idToken: string): DecodedIdToken {
  const parts = idToken.split('.')
  if (parts.length !== 3) return { email: null, exp: null }
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(normalized)) as Record<string, unknown>
    const email = typeof payload.email === 'string' ? payload.email : null
    const exp = typeof payload.exp === 'number' ? payload.exp : null
    return { email, exp }
  } catch {
    return { email: null, exp: null }
  }
}

export function isTokenExpired(exp: number | null, nowSeconds: number): boolean {
  if (exp === null) return true
  return nowSeconds >= exp - EXPIRY_SKEW_SECONDS
}

export class GoogleAuthAdapter implements AuthAdapter {
  private async readSession(): Promise<StoredSession | undefined> {
    const stored = await chrome.storage.local.get(SESSION_STORAGE_KEY)
    return stored[SESSION_STORAGE_KEY] as StoredSession | undefined
  }

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

    const { email } = decodeIdToken(idToken)
    if (!email) return null

    // Immediately trade the Google id_token for a backend session token.
    // If that fails the session is still usable -- the backend accepts the
    // raw id_token too -- and the next getValidToken() will retry.
    const exchanged = await exchangeIdTokenForSession(idToken)
    const session: StoredSession = exchanged
      ? {
          email: exchanged.email,
          idToken,
          sessionToken: exchanged.sessionToken,
          sessionExpiresAt: exchanged.expiresAt,
        }
      : { email, idToken }
    await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session })
    return session
  }

  async signIn(): Promise<{ email: string; idToken: string } | null> {
    return this.runAuthFlow(true)
  }

  async signOut(): Promise<void> {
    await chrome.storage.local.remove(SESSION_STORAGE_KEY)
  }

  async getCurrentSession(): Promise<{ email: string } | null> {
    const session = await this.readSession()
    return session ? { email: session.email } : null
  }

  /** Returns the bearer token to send on API calls: the backend session
   * token when one is held and still fresh, otherwise a silent re-auth +
   * exchange, otherwise (offline) a still-valid Google id_token, otherwise
   * null. The returned string may be either token kind -- the backend
   * accepts both. */
  async getValidToken(): Promise<string | null> {
    const session = await this.readSession()
    const now = Math.floor(Date.now() / 1000)

    if (session?.sessionToken && isSessionTokenFresh(session.sessionExpiresAt, now)) {
      return session.sessionToken
    }

    // No fresh session token: either the stored session predates Phase 2,
    // the exchange failed earlier, or the token is near expiry. A silent
    // re-auth refreshes the Google id_token and re-exchanges in one step.
    const refreshed = await this.runAuthFlow(false)
    if (refreshed) return refreshed.sessionToken ?? refreshed.idToken

    // Silent refresh failed (offline, or the Google session is gone). If
    // the stored Google id_token is still valid, fall back to it so a
    // transient failure doesn't force a full interactive sign-in.
    if (session) {
      const { exp } = decodeIdToken(session.idToken)
      if (!isTokenExpired(exp, now)) return session.sessionToken ?? session.idToken
    }

    // Nothing usable left. Clear the stale session so getCurrentSession()
    // reports signed-out rather than an email with no working token.
    await chrome.storage.local.remove(SESSION_STORAGE_KEY)
    return null
  }
}
