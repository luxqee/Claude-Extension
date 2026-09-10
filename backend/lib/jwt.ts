import { createHmac, timingSafeEqual } from 'node:crypto'

// A deliberately small hand-rolled HS256 JWT signer/verifier, rather than
// pulling in a dependency. The backend only ever issues and checks its
// own session tokens with a single symmetric secret, so the surface is
// tiny: one fixed header, one claim shape, HMAC-SHA256, constant-time
// signature compare. Matches this project's preference for a maintained
// constant over a new package (cf. the hardcoded public-domain list).

export interface SessionClaims {
  /** subject -- the member's email, same value as `email` */
  sub: string
  email: string
  /** issued-at, seconds since epoch */
  iat: number
  /** expiry, seconds since epoch */
  exp: number
}

const HEADER_SEGMENT = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')

function sign(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest()
}

export function signSessionToken(
  email: string,
  secret: string,
  nowSeconds: number,
  ttlSeconds: number,
): string {
  const claims: SessionClaims = {
    sub: email,
    email,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  }
  const payloadSegment = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signingInput = `${HEADER_SEGMENT}.${payloadSegment}`
  const signatureSegment = sign(signingInput, secret).toString('base64url')
  return `${signingInput}.${signatureSegment}`
}

/**
 * Returns the token's claims when the signature is valid, the header is
 * exactly `{alg:HS256,typ:JWT}`, the claim shape is right, and `exp` is
 * still in the future. Returns `null` for anything else -- a malformed
 * token, a bad signature, an `alg:none` attempt, or an expired token.
 */
export function verifySessionToken(
  token: string,
  secret: string,
  nowSeconds: number,
): SessionClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerSegment, payloadSegment, signatureSegment] = parts

  // Reject anything whose header isn't our exact fixed header. This also
  // closes `alg:none` and algorithm-substitution attempts before the
  // signature is even considered.
  if (headerSegment !== HEADER_SEGMENT) return null

  const expected = sign(`${headerSegment}.${payloadSegment}`, secret)
  let provided: Buffer
  try {
    provided = Buffer.from(signatureSegment, 'base64url')
  } catch {
    return null
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Record<string, unknown>
  if (
    typeof candidate.sub !== 'string' ||
    typeof candidate.email !== 'string' ||
    typeof candidate.iat !== 'number' ||
    typeof candidate.exp !== 'number'
  ) {
    return null
  }
  if (nowSeconds >= candidate.exp) return null

  return {
    sub: candidate.sub,
    email: candidate.email,
    iat: candidate.iat,
    exp: candidate.exp,
  }
}
