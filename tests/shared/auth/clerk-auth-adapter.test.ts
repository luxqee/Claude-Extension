import { describe, expect, it } from 'vitest'
import { buildClerkAuthUrl, extractCodeFromRedirect } from '../../../src/shared/auth/clerk-auth-adapter'

const REDIRECT = 'https://fhaeedmmhjjkhnopifppigddjbbmdegh.chromiumapp.org/'

describe('buildClerkAuthUrl', () => {
  it('omits prompt by default (silent refresh reuses the live session)', () => {
    const url = new URL(buildClerkAuthUrl(REDIRECT, 'challenge', 'state1'))
    expect(url.searchParams.has('prompt')).toBe(false)
  })

  it('sets prompt=login when asked, forcing re-authentication', () => {
    const url = new URL(buildClerkAuthUrl(REDIRECT, 'challenge', 'state1', 'login'))
    expect(url.searchParams.get('prompt')).toBe('login')
  })

  it('always includes the PKCE and redirect params', () => {
    const url = new URL(buildClerkAuthUrl(REDIRECT, 'my-challenge', 'my-state'))
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(url.searchParams.get('code_challenge')).toBe('my-challenge')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe('my-state')
    expect(url.searchParams.get('response_type')).toBe('code')
  })
})

describe('extractCodeFromRedirect', () => {
  it('returns the code when state matches', () => {
    const redirect = `${REDIRECT}?code=abc123&state=xyz`
    expect(extractCodeFromRedirect(redirect, 'xyz')).toBe('abc123')
  })

  it('returns null when state does not match (anti-CSRF)', () => {
    const redirect = `${REDIRECT}?code=abc123&state=xyz`
    expect(extractCodeFromRedirect(redirect, 'different')).toBeNull()
  })

  it('returns null when the redirect has no query string', () => {
    expect(extractCodeFromRedirect(REDIRECT, 'xyz')).toBeNull()
  })
})
