import type { VercelRequest, VercelResponse } from '@vercel/node'
import { signSessionToken } from '../../lib/jwt.js'
import { extractBearerToken, verifyExternalToken } from '../../lib/resolve-email.js'

// Exchanges a provider id_token (Google or Clerk, from the extension's
// sign-in flow) for a backend-issued session token the extension then
// uses for every other API call. Decouples day-to-day operation from
// refreshing a short-lived provider token -- see
// docs/superpowers/specs/2026-09-10-phase2-session-token-design.md.

const SESSION_JWT_SECRET = process.env.SESSION_JWT_SECRET ?? ''
const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  if (!SESSION_JWT_SECRET) {
    console.error('[auth/session] SESSION_JWT_SECRET is not configured')
    res.status(500).json({ error: 'session tokens are not configured' })
    return
  }

  const idToken = extractBearerToken(req.headers.authorization)
  if (!idToken) {
    res.status(401).json({ error: 'missing token' })
    return
  }

  const email = await verifyExternalToken(idToken)
  if (!email) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  const now = Math.floor(Date.now() / 1000)
  const sessionToken = signSessionToken(email, SESSION_JWT_SECRET, now, SESSION_TTL_SECONDS)
  res.status(200).json({
    sessionToken,
    email,
    expiresAt: new Date((now + SESSION_TTL_SECONDS) * 1000).toISOString(),
  })
}
