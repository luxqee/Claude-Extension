import type { ProviderId } from './providers'

const SESSION_STORAGE_KEY = 'authSession'
/** Refresh the backend session token this many seconds before it expires. */
const SESSION_EXPIRY_SKEW_SECONDS = 5 * 60

export interface StoredSession {
  /** Which sign-in method produced this session. Only 'clerk' today; the
   * field is kept so an older stored session still parses. */
  provider?: ProviderId
  email: string
  /** The backend session token, also stored here so getValidToken's
   * fallback paths have a single field to read. */
  idToken: string
  /** Backend-issued session JWT used for API calls once obtained. */
  sessionToken?: string
  /** `sessionToken`'s expiry, seconds since epoch. */
  sessionExpiresAt?: number
}

export async function readSession(): Promise<StoredSession | undefined> {
  const stored = await chrome.storage.local.get(SESSION_STORAGE_KEY)
  return stored[SESSION_STORAGE_KEY] as StoredSession | undefined
}

export async function writeSession(session: StoredSession): Promise<void> {
  await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session })
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove(SESSION_STORAGE_KEY)
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

/** Decodes a JWT payload without verifying (display only). */
export function decodeJwtPayload(token: string): { email: string | null; exp: number | null } {
  const parts = token.split('.')
  if (parts.length !== 3) return { email: null, exp: null }
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(normalized)) as Record<string, unknown>
    const email =
      typeof payload.email === 'string'
        ? payload.email
        : typeof payload.email_address === 'string'
          ? payload.email_address
          : null
    const exp = typeof payload.exp === 'number' ? payload.exp : null
    return { email, exp }
  } catch {
    return { email: null, exp: null }
  }
}

const EXPIRY_SKEW_SECONDS = 60
export function isTokenExpired(exp: number | null, nowSeconds: number): boolean {
  if (exp === null) return true
  return nowSeconds >= exp - EXPIRY_SKEW_SECONDS
}
