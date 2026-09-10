import { API_BASE_URL } from '../api-base'
import type { ProviderId } from './providers'

const SESSION_STORAGE_KEY = 'authSession'
/** Refresh the backend session token this many seconds before it expires. */
const SESSION_EXPIRY_SKEW_SECONDS = 5 * 60

export interface StoredSession {
  /** Which sign-in method produced this session. Absent on sessions
   * written by builds before multi-provider support -- treat as google. */
  provider?: ProviderId
  email: string
  /** The provider's most recent id_token (Google or Clerk). Kept so a
   * backend session token can be re-minted without a fresh interactive
   * sign-in, and as a fallback the backend still accepts directly. */
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

/**
 * Trades a provider id_token for a backend session token via
 * `POST /api/auth/session`. Works for any provider the backend can
 * verify (Google, Clerk). Returns null on any failure -- callers fall
 * back to sending the id_token directly.
 */
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
