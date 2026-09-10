import { describe, expect, it } from 'vitest'
import { signSessionToken, verifySessionToken } from './jwt'

const SECRET = 'test-secret-value'
const NOW = 1_700_000_000
const TTL = 14 * 24 * 60 * 60

describe('signSessionToken / verifySessionToken', () => {
  it('round-trips: a freshly signed token verifies to its claims', () => {
    const token = signSessionToken('alice@acme.com', SECRET, NOW, TTL)
    expect(verifySessionToken(token, SECRET, NOW)).toEqual({
      sub: 'alice@acme.com',
      email: 'alice@acme.com',
      iat: NOW,
      exp: NOW + TTL,
    })
  })

  it('still verifies just before expiry and fails at/after it', () => {
    const token = signSessionToken('a@b.com', SECRET, NOW, TTL)
    expect(verifySessionToken(token, SECRET, NOW + TTL - 1)).not.toBeNull()
    expect(verifySessionToken(token, SECRET, NOW + TTL)).toBeNull()
    expect(verifySessionToken(token, SECRET, NOW + TTL + 999)).toBeNull()
  })

  it('rejects a token signed with a different secret', () => {
    const token = signSessionToken('a@b.com', 'other-secret', NOW, TTL)
    expect(verifySessionToken(token, SECRET, NOW)).toBeNull()
  })

  it('rejects a tampered payload', () => {
    const token = signSessionToken('a@b.com', SECRET, NOW, TTL)
    const [header, , signature] = token.split('.')
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: 'attacker@evil.com', email: 'attacker@evil.com', iat: NOW, exp: NOW + TTL }),
    ).toString('base64url')
    expect(verifySessionToken(`${header}.${forgedPayload}.${signature}`, SECRET, NOW)).toBeNull()
  })

  it('rejects a tampered signature', () => {
    const token = signSessionToken('a@b.com', SECRET, NOW, TTL)
    const [header, payload] = token.split('.')
    const forgedSig = Buffer.from('not-the-real-signature').toString('base64url')
    expect(verifySessionToken(`${header}.${payload}.${forgedSig}`, SECRET, NOW)).toBeNull()
  })

  it('rejects an alg:none token even when its signature segment is empty', () => {
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(
      JSON.stringify({ sub: 'a@b.com', email: 'a@b.com', iat: NOW, exp: NOW + TTL }),
    ).toString('base64url')
    expect(verifySessionToken(`${noneHeader}.${payload}.`, SECRET, NOW)).toBeNull()
  })

  it('rejects malformed input (wrong segment count, empty string, garbage)', () => {
    expect(verifySessionToken('', SECRET, NOW)).toBeNull()
    expect(verifySessionToken('a.b', SECRET, NOW)).toBeNull()
    expect(verifySessionToken('a.b.c.d', SECRET, NOW)).toBeNull()
    expect(verifySessionToken('not-a-token', SECRET, NOW)).toBeNull()
  })

  it('rejects a token whose payload is valid base64url but not the expected claim shape', () => {
    const token = signSessionToken('a@b.com', SECRET, NOW, TTL)
    const [header] = token.split('.')
    const shapelessPayload = Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64url')
    const signature = Buffer.from('x').toString('base64url')
    expect(verifySessionToken(`${header}.${shapelessPayload}.${signature}`, SECRET, NOW)).toBeNull()
  })
})
