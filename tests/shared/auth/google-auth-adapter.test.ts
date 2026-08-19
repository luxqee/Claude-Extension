declare const Buffer: {
  from(data: string | object): {
    toString(encoding: 'base64url'): string
  }
}

import { describe, expect, it } from 'vitest'
import {
  buildGoogleAuthUrl,
  extractIdTokenFromRedirect,
  decodeIdToken,
  isTokenExpired,
} from '../../../src/shared/auth/google-auth-adapter'

function makeFakeIdToken(payload: Record<string, unknown>): string {
  const header = { alg: 'RS256', typ: 'JWT' }
  const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${encode(header)}.${encode(payload)}.fake-signature`
}

describe('buildGoogleAuthUrl', () => {
  it('includes the client id, id_token response type, redirect uri, scope, and nonce', () => {
    const url = buildGoogleAuthUrl('https://abc123.chromiumapp.org/', 'test-nonce')
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(parsed.searchParams.get('client_id')).toBe(
      '14020508582-rsh9tk73lhm3c3ekki32mvfc9a2m3di6.apps.googleusercontent.com',
    )
    expect(parsed.searchParams.get('response_type')).toBe('id_token')
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://abc123.chromiumapp.org/')
    expect(parsed.searchParams.get('scope')).toBe('openid email')
    expect(parsed.searchParams.get('nonce')).toBe('test-nonce')
  })
})

describe('extractIdTokenFromRedirect', () => {
  it('extracts the id_token from a redirect URL fragment', () => {
    const url = 'https://abc123.chromiumapp.org/#id_token=abc.def.ghi&state=xyz'
    expect(extractIdTokenFromRedirect(url)).toBe('abc.def.ghi')
  })

  it('returns null when the URL has no fragment', () => {
    expect(extractIdTokenFromRedirect('https://abc123.chromiumapp.org/')).toBeNull()
  })

  it('returns null when the fragment has no id_token param', () => {
    expect(extractIdTokenFromRedirect('https://abc123.chromiumapp.org/#state=xyz')).toBeNull()
  })
})

describe('decodeIdToken', () => {
  it('decodes email and exp from a well-formed token', () => {
    const token = makeFakeIdToken({ email: 'alice@acme.com', exp: 1999999999 })
    expect(decodeIdToken(token)).toEqual({ email: 'alice@acme.com', exp: 1999999999 })
  })

  it('returns null email and exp for a token with fewer than 3 parts', () => {
    expect(decodeIdToken('not-a-jwt')).toEqual({ email: null, exp: null })
  })

  it('returns null email and exp when the payload is not valid JSON', () => {
    const badPayload = Buffer.from('not json').toString('base64url')
    expect(decodeIdToken(`header.${badPayload}.sig`)).toEqual({ email: null, exp: null })
  })

  it('returns null email when the payload has no email claim', () => {
    const token = makeFakeIdToken({ exp: 1999999999 })
    expect(decodeIdToken(token)).toEqual({ email: null, exp: 1999999999 })
  })
})

describe('isTokenExpired', () => {
  const now = 1700000000

  it('returns false for an exp comfortably in the future', () => {
    expect(isTokenExpired(now + 3600, now)).toBe(false)
  })

  it('returns true for an exp in the past', () => {
    expect(isTokenExpired(now - 10, now)).toBe(true)
  })

  it('returns true for an exp within the 60-second skew window', () => {
    expect(isTokenExpired(now + 30, now)).toBe(true)
  })

  it('returns true when exp is null', () => {
    expect(isTokenExpired(null, now)).toBe(true)
  })
})
