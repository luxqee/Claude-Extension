import type { AuthAdapter } from './auth-adapter'

const GOOGLE_CLIENT_ID = '14020508582-rsh9tk73lhm3c3ekki32mvfc9a2m3di6.apps.googleusercontent.com'
const SESSION_STORAGE_KEY = 'authSession'
const EXPIRY_SKEW_SECONDS = 60

interface StoredSession {
  email: string
  idToken: string
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
  private async runAuthFlow(interactive: boolean): Promise<{ email: string; idToken: string } | null> {
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

    const session: StoredSession = { email, idToken }
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
    const stored = await chrome.storage.local.get(SESSION_STORAGE_KEY)
    const session = stored[SESSION_STORAGE_KEY] as StoredSession | undefined
    return session ? { email: session.email } : null
  }

  async getValidIdToken(): Promise<string | null> {
    const stored = await chrome.storage.local.get(SESSION_STORAGE_KEY)
    const session = stored[SESSION_STORAGE_KEY] as StoredSession | undefined
    if (session) {
      const { exp } = decodeIdToken(session.idToken)
      if (!isTokenExpired(exp, Math.floor(Date.now() / 1000))) {
        return session.idToken
      }
    }
    const refreshed = await this.runAuthFlow(false)
    if (!refreshed) {
      // Silent refresh failed outright -- the stored session is stale and
      // unusable. Clear it so getCurrentSession() correctly reflects that
      // sign-in is needed again, rather than continuing to report an email
      // that no longer has a working token behind it.
      await chrome.storage.local.remove(SESSION_STORAGE_KEY)
    }
    return refreshed?.idToken ?? null
  }
}
