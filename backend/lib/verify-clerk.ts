import { createPublicKey, verify as cryptoVerify } from 'node:crypto'

// Verifies a Clerk-issued id_token (from the extension's Clerk OAuth
// flow) against Clerk's JWKS. RS256 only. Returns the verified email, or
// null for anything wrong. Inert when CLERK_ISSUER is unset, so a
// deployment without Clerk configured just skips this path.

const CLERK_ISSUER = (process.env.CLERK_ISSUER ?? '').replace(/\/+$/, '')
const JWKS_TTL_MS = 10 * 60 * 1000

interface Jwk {
  kid: string
  kty: string
  n: string
  e: string
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null

function b64urlToBuffer(segment: string): Buffer {
  return Buffer.from(segment, 'base64url')
}

async function fetchJwks(force: boolean): Promise<Jwk[]> {
  if (!force && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys
  }
  const response = await fetch(`${CLERK_ISSUER}/.well-known/jwks.json`)
  if (!response.ok) throw new Error(`jwks fetch failed: ${response.status}`)
  const body = (await response.json()) as { keys?: unknown }
  const keys = Array.isArray(body.keys)
    ? (body.keys.filter(
        (k): k is Jwk =>
          typeof k === 'object' &&
          k !== null &&
          typeof (k as Jwk).kid === 'string' &&
          typeof (k as Jwk).n === 'string' &&
          typeof (k as Jwk).e === 'string',
      ) as Jwk[])
    : []
  jwksCache = { keys, fetchedAt: Date.now() }
  return keys
}

/**
 * Split so the crypto/claims logic can be unit-tested without a network
 * JWKS fetch: `findKey` is injected in tests.
 */
export async function verifyClerkTokenWith(
  token: string,
  issuer: string,
  findKey: (kid: string) => Promise<Jwk | null>,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  if (!issuer) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null

  let header: { kid?: unknown; alg?: unknown }
  let payload: Record<string, unknown>
  try {
    header = JSON.parse(b64urlToBuffer(parts[0]).toString('utf8'))
    payload = JSON.parse(b64urlToBuffer(parts[1]).toString('utf8'))
  } catch {
    return null
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null

  const jwk = await findKey(header.kid)
  if (!jwk) return null

  let publicKey
  try {
    publicKey = createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' })
  } catch {
    return null
  }

  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`)
  let signatureOk = false
  try {
    signatureOk = cryptoVerify('RSA-SHA256', signingInput, publicKey, b64urlToBuffer(parts[2]))
  } catch {
    return null
  }
  if (!signatureOk) return null

  if (typeof payload.exp === 'number' && nowSeconds >= payload.exp) return null
  if (typeof payload.nbf === 'number' && nowSeconds < payload.nbf) return null
  const iss = typeof payload.iss === 'string' ? payload.iss.replace(/\/+$/, '') : ''
  if (iss !== issuer.replace(/\/+$/, '')) return null
  if (payload.email_verified === false) return null

  const email =
    typeof payload.email === 'string'
      ? payload.email
      : typeof payload.email_address === 'string'
        ? payload.email_address
        : null
  return email
}

export async function verifyClerkToken(token: string): Promise<string | null> {
  if (!CLERK_ISSUER) return null
  const findKey = async (kid: string): Promise<Jwk | null> => {
    try {
      let keys = await fetchJwks(false)
      let match = keys.find((k) => k.kid === kid)
      if (!match) {
        keys = await fetchJwks(true) // key rotation -- refresh once
        match = keys.find((k) => k.kid === kid)
      }
      return match ?? null
    } catch (error) {
      console.error('[verify-clerk] JWKS lookup failed', error)
      return null
    }
  }
  return verifyClerkTokenWith(token, CLERK_ISSUER, findKey)
}
