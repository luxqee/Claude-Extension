import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'
import { signSessionToken } from '../../lib/jwt.js'
import { extractBearerToken, verifyExternalToken } from '../../lib/resolve-email.js'
import { verifyClerkToken } from '../../lib/verify-clerk.js'
import { checkRateLimit, clientIp } from '../../lib/rate-limit.js'

const sql = neon(process.env.DATABASE_URL ?? '')

// Mints a backend session token (14-day HS256 JWT) from a verified
// identity. Two ways in:
//
//   A. Authorization: Bearer <provider id_token>   (Google, or Clerk when
//      the extension already holds an id_token)
//   B. Body { code, redirectUri, codeVerifier }    -- the Clerk OAuth
//      authorization-code + PKCE exchange, done here so the client secret
//      (if the Clerk app is confidential) stays server-side.
//
// See docs/superpowers/specs/2026-09-10-phase2-session-token-design.md.

const SESSION_JWT_SECRET = process.env.SESSION_JWT_SECRET ?? ''
const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60

const CLERK_ISSUER = (process.env.CLERK_ISSUER ?? '').replace(/\/+$/, '')
const CLERK_OAUTH_CLIENT_ID = process.env.CLERK_OAUTH_CLIENT_ID ?? ''
const CLERK_OAUTH_CLIENT_SECRET = process.env.CLERK_OAUTH_CLIENT_SECRET ?? ''

async function clerkCodeToIdToken(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<string | null> {
  if (!CLERK_ISSUER || !CLERK_OAUTH_CLIENT_ID) return null
  const params: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: CLERK_OAUTH_CLIENT_ID,
    code_verifier: codeVerifier,
  }
  if (CLERK_OAUTH_CLIENT_SECRET) params.client_secret = CLERK_OAUTH_CLIENT_SECRET
  try {
    const response = await fetch(`${CLERK_ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    })
    if (!response.ok) {
      console.error('[auth/session] Clerk token endpoint returned', response.status)
      return null
    }
    const body = (await response.json()) as { id_token?: unknown }
    return typeof body.id_token === 'string' ? body.id_token : null
  } catch (error) {
    console.error('[auth/session] Clerk code exchange failed', error)
    return null
  }
}

function issueSession(res: VercelResponse, email: string): void {
  const now = Math.floor(Date.now() / 1000)
  res.status(200).json({
    sessionToken: signSessionToken(email, SESSION_JWT_SECRET, now, SESSION_TTL_SECONDS),
    email,
    expiresAt: new Date((now + SESSION_TTL_SECONDS) * 1000).toISOString(),
  })
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

  // Per-IP: this is the pre-auth entry point (it verifies the token itself),
  // so there is no email to key on yet.
  const limit = await checkRateLimit(sql, `auth-session:${clientIp(req.headers['x-forwarded-for'])}`, 30, 60)
  if (!limit.ok) {
    res.setHeader('Retry-After', String(limit.retryAfter))
    res.status(429).json({ error: 'too many requests' })
    return
  }

  // req.body is undefined when the request carries no JSON body -- which is
  // exactly how the Google path calls this endpoint (Authorization header
  // only). Without this guard `typeof body.code` throws and the whole
  // function 500s (FUNCTION_INVOCATION_FAILED) instead of taking path A.
  const body = (req.body ?? {}) as { code?: unknown; redirectUri?: unknown; codeVerifier?: unknown }

  // B. Clerk authorization-code exchange
  if (typeof body.code === 'string') {
    if (typeof body.redirectUri !== 'string' || typeof body.codeVerifier !== 'string') {
      res.status(400).json({ error: 'redirectUri and codeVerifier are required with code' })
      return
    }
    const idToken = await clerkCodeToIdToken(body.code, body.redirectUri, body.codeVerifier)
    if (!idToken) {
      res.status(401).json({ error: 'code exchange failed' })
      return
    }
    const email = await verifyClerkToken(idToken)
    if (!email) {
      res.status(401).json({ error: 'invalid token' })
      return
    }
    issueSession(res, email)
    return
  }

  // A. Bearer provider id_token
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
  issueSession(res, email)
}
