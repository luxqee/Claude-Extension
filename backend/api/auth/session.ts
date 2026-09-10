import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { signSessionToken } from '../../lib/jwt.js'

// Exchanges a Google id_token (from the extension's sign-in flow) for a
// backend-issued session token the extension then uses for every other
// API call. This decouples day-to-day operation from refreshing a
// short-lived Google id_token -- see
// docs/superpowers/specs/2026-09-10-phase2-session-token-design.md.

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
const SESSION_JWT_SECRET = process.env.SESSION_JWT_SECRET ?? ''
const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60

const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID)

async function verifyEmail(idToken: string): Promise<string | null> {
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()
    if (!payload?.email_verified) return null
    return payload.email ?? null
  } catch (error) {
    console.error('[auth/session] token verification failed', error)
    return null
  }
}

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

  const authHeader = req.headers.authorization
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!idToken) {
    res.status(401).json({ error: 'missing token' })
    return
  }

  const email = await verifyEmail(idToken)
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
