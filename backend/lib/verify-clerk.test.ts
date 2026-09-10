import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, createSign } from 'node:crypto'
import { verifyClerkTokenWith } from './verify-clerk'

const ISSUER = 'https://innocent-lamb-6401.clerk.accounts.dev'
const NOW = 1_700_000_000

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string }
const KEY = { kid: 'test-kid', kty: jwk.kty, n: jwk.n, e: jwk.e }

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

function makeToken(payload: Record<string, unknown>, opts: { kid?: string; alg?: string } = {}): string {
  const header = b64url(JSON.stringify({ alg: opts.alg ?? 'RS256', typ: 'JWT', kid: opts.kid ?? 'test-kid' }))
  const body = b64url(JSON.stringify(payload))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${body}`)
  const sig = signer.sign(privateKey).toString('base64url')
  return `${header}.${body}.${sig}`
}

const findKey = async (kid: string) => (kid === KEY.kid ? KEY : null)

describe('verifyClerkTokenWith', () => {
  it('returns the email from a valid Clerk id_token', async () => {
    const token = makeToken({ iss: ISSUER, email: 'a@b.com', email_verified: true, exp: NOW + 3600 })
    expect(await verifyClerkTokenWith(token, ISSUER, findKey, NOW)).toBe('a@b.com')
  })

  it('tolerates a trailing slash on either issuer', async () => {
    const token = makeToken({ iss: `${ISSUER}/`, email: 'a@b.com', exp: NOW + 3600 })
    expect(await verifyClerkTokenWith(token, `${ISSUER}/`, findKey, NOW)).toBe('a@b.com')
  })

  it('rejects a token whose issuer does not match', async () => {
    const token = makeToken({ iss: 'https://evil.example', email: 'a@b.com', exp: NOW + 3600 })
    expect(await verifyClerkTokenWith(token, ISSUER, findKey, NOW)).toBeNull()
  })

  it('rejects an expired token', async () => {
    const token = makeToken({ iss: ISSUER, email: 'a@b.com', exp: NOW - 10 })
    expect(await verifyClerkTokenWith(token, ISSUER, findKey, NOW)).toBeNull()
  })

  it('rejects email_verified: false', async () => {
    const token = makeToken({ iss: ISSUER, email: 'a@b.com', email_verified: false, exp: NOW + 3600 })
    expect(await verifyClerkTokenWith(token, ISSUER, findKey, NOW)).toBeNull()
  })

  it('rejects a bad signature (payload tampered after signing)', async () => {
    const token = makeToken({ iss: ISSUER, email: 'a@b.com', exp: NOW + 3600 })
    const [h, , s] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ iss: ISSUER, email: 'attacker@evil.com', exp: NOW + 3600 })).toString(
      'base64url',
    )
    expect(await verifyClerkTokenWith(`${h}.${forged}.${s}`, ISSUER, findKey, NOW)).toBeNull()
  })

  it('rejects a non-RS256 alg', async () => {
    const token = makeToken({ iss: ISSUER, email: 'a@b.com', exp: NOW + 3600 }, { alg: 'HS256' })
    expect(await verifyClerkTokenWith(token, ISSUER, findKey, NOW)).toBeNull()
  })

  it('rejects when the signing key id is unknown', async () => {
    const token = makeToken({ iss: ISSUER, email: 'a@b.com', exp: NOW + 3600 }, { kid: 'other-kid' })
    expect(await verifyClerkTokenWith(token, ISSUER, findKey, NOW)).toBeNull()
  })

  it('returns null when no issuer is configured', async () => {
    const token = makeToken({ iss: ISSUER, email: 'a@b.com', exp: NOW + 3600 })
    expect(await verifyClerkTokenWith(token, '', findKey, NOW)).toBeNull()
  })

  it('returns null for a malformed token', async () => {
    expect(await verifyClerkTokenWith('not.a.jwt.at.all', ISSUER, findKey, NOW)).toBeNull()
    expect(await verifyClerkTokenWith('garbage', ISSUER, findKey, NOW)).toBeNull()
  })
})
