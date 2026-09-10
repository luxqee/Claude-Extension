import { OAuth2Client } from 'google-auth-library'
import { verifySessionToken } from './jwt.js'

// Single place every endpoint turns an `Authorization` header into a
// verified email. Accepts either kind of bearer token:
//
//   1. A session JWT this backend issued (`/api/auth/session`). Verified
//      locally with SESSION_JWT_SECRET -- no network call.
//   2. A Google `id_token` straight from the extension's sign-in flow.
//      Verified against Google, exactly as every endpoint did inline
//      before this helper existed.
//
// Everything downstream (role/status checks, RLS org scoping,
// resolveDirectorContext) keys off the returned email string alone, so
// callers don't care which kind of token it was.

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
const SESSION_JWT_SECRET = process.env.SESSION_JWT_SECRET ?? ''

const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID)

export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ')) {
    return null
  }
  const token = authorizationHeader.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}

export async function verifyGoogleIdToken(idToken: string): Promise<string | null> {
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()
    if (!payload?.email_verified) return null
    return payload.email ?? null
  } catch (error) {
    console.error('[resolve-email] Google id_token verification failed', error)
    return null
  }
}

export async function resolveEmail(authorizationHeader: string | undefined): Promise<string | null> {
  const token = extractBearerToken(authorizationHeader)
  if (!token) return null

  // Session JWT first: it's the common case once a client has exchanged,
  // and it costs nothing (no network). A missing secret just means this
  // deployment hasn't enabled session tokens yet -- skip straight to
  // Google rather than failing.
  if (SESSION_JWT_SECRET) {
    const claims = verifySessionToken(token, SESSION_JWT_SECRET, Math.floor(Date.now() / 1000))
    if (claims) return claims.email
  }

  return verifyGoogleIdToken(token)
}
