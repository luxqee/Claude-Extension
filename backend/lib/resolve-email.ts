import { verifySessionToken } from './jwt.js'
import { verifyClerkToken } from './verify-clerk.js'

// Single place every endpoint turns an `Authorization` header into a
// verified email. Accepts:
//
//   1. A session JWT this backend issued (`/api/auth/session`). Verified
//      locally with SESSION_JWT_SECRET -- no network call.
//   2. A Clerk id_token (Clerk OAuth flow). Verified against Clerk's JWKS
//      when CLERK_ISSUER is set.
//
// Everything downstream (role/status checks, RLS org scoping,
// resolveDirectorContext) keys off the returned email string alone.

const SESSION_JWT_SECRET = process.env.SESSION_JWT_SECRET ?? ''

export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ')) {
    return null
  }
  const token = authorizationHeader.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}

/** Verifies a token from an external identity provider (Clerk). Used when
 * minting a fresh backend session token. */
export async function verifyExternalToken(token: string): Promise<string | null> {
  return verifyClerkToken(token)
}

export async function resolveEmail(authorizationHeader: string | undefined): Promise<string | null> {
  const token = extractBearerToken(authorizationHeader)
  if (!token) return null

  // Session JWT first: the common case once a client has exchanged, and it
  // costs nothing (no network). A missing secret just means session tokens
  // aren't enabled on this deployment -- fall through to the provider.
  if (SESSION_JWT_SECRET) {
    const claims = verifySessionToken(token, SESSION_JWT_SECRET, Math.floor(Date.now() / 1000))
    if (claims) return claims.email
  }

  return verifyExternalToken(token)
}
