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

type ClerkExchangeResult = { ok: true; idToken: string } | { ok: false; reason: string }

async function clerkCodeToIdToken(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<ClerkExchangeResult> {
  if (!CLERK_ISSUER || !CLERK_OAUTH_CLIENT_ID) {
    return { ok: false, reason: 'CLERK_ISSUER or CLERK_OAUTH_CLIENT_ID not configured on the server' }
  }
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
    // Clerk's token endpoint returns a JSON body on both success and error
    // (e.g. {error:"invalid_grant", error_description:"..."}); read it
    // either way so a misconfigured redirect_uri / client_id / secret
    // shows up as a real reason instead of a bare status code.
    let parsed: { id_token?: unknown; error?: unknown; error_description?: unknown } = {}
    try {
      parsed = (await response.json()) as typeof parsed
    } catch {
      /* non-JSON body -- fall through to the generic status-based reason */
    }
    if (!response.ok) {
      const reason =
        typeof parsed.error_description === 'string'
          ? parsed.error_description
          : typeof parsed.error === 'string'
            ? parsed.error
            : `HTTP ${response.status}`
      console.error('[auth/session] Clerk token endpoint rejected the exchange:', reason)
      return { ok: false, reason }
    }
    if (typeof parsed.id_token !== 'string') {
      console.error('[auth/session] Clerk token endpoint returned no id_token', parsed)
      return { ok: false, reason: 'Clerk did not return an id_token (check requested scopes include openid)' }
    }
    return { ok: true, idToken: parsed.id_token }
  } catch (error) {
    console.error('[auth/session] Clerk code exchange request failed', error)
    return { ok: false, reason: 'network error reaching Clerk' }
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
    const exchanged = await clerkCodeToIdToken(body.code, body.redirectUri, body.codeVerifier)
    if (!exchanged.ok) {
      // `detail` is Clerk's own OAuth error, not a secret -- safe to return
      // to the caller who just made this exact request, and is the
      // difference between "figure it out from Vercel logs" and "read the
      // error in the extension's own console".
      res.status(401).json({ error: 'code exchange failed', detail: exchanged.reason })
      return
    }
    const email = await verifyClerkToken(exchanged.idToken)
    if (!email) {
      res.status(401).json({ error: 'invalid token', detail: 'Clerk id_token failed local verification (issuer/signature/expiry)' })
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
