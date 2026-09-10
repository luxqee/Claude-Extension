import { describe, expect, it, vi, beforeEach } from 'vitest'
import { signSessionToken } from './jwt'

const { mockVerifyIdToken } = vi.hoisted(() => ({ mockVerifyIdToken: vi.fn() }))

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken(...args: unknown[]) {
      return mockVerifyIdToken(...args)
    }
  },
}))

const SECRET = 'resolve-email-unit-secret'
const TTL = 14 * 24 * 60 * 60

async function loadResolveEmail(env: { secret?: string } = {}) {
  vi.resetModules()
  process.env.SESSION_JWT_SECRET = env.secret ?? SECRET
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id'
  return import('./resolve-email')
}

function googlePayload(payload: Record<string, unknown>) {
  return { getPayload: () => payload }
}

describe('resolveEmail', () => {
  beforeEach(() => {
    mockVerifyIdToken.mockReset()
  })

  it('returns null when the header is missing or not a Bearer token', async () => {
    const { resolveEmail } = await loadResolveEmail()
    expect(await resolveEmail(undefined)).toBeNull()
    expect(await resolveEmail('')).toBeNull()
    expect(await resolveEmail('Basic abc')).toBeNull()
    expect(await resolveEmail('Bearer ')).toBeNull()
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
  })

  it('resolves a valid session JWT locally without calling Google', async () => {
    const { resolveEmail } = await loadResolveEmail()
    const token = signSessionToken('alice@acme.com', SECRET, Math.floor(Date.now() / 1000), TTL)
    expect(await resolveEmail(`Bearer ${token}`)).toBe('alice@acme.com')
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
  })

  it('falls back to Google verification when the token is not a session JWT', async () => {
    const { resolveEmail } = await loadResolveEmail()
    mockVerifyIdToken.mockResolvedValue(googlePayload({ email_verified: true, email: 'bob@acme.com' }))
    expect(await resolveEmail('Bearer a-google-id-token')).toBe('bob@acme.com')
    expect(mockVerifyIdToken).toHaveBeenCalledOnce()
  })

  it('falls back to Google when the session JWT is expired', async () => {
    const { resolveEmail } = await loadResolveEmail()
    const expired = signSessionToken('old@acme.com', SECRET, Math.floor(Date.now() / 1000) - TTL - 10, TTL)
    mockVerifyIdToken.mockResolvedValue(googlePayload({ email_verified: true, email: 'fresh@acme.com' }))
    expect(await resolveEmail(`Bearer ${expired}`)).toBe('fresh@acme.com')
    expect(mockVerifyIdToken).toHaveBeenCalledOnce()
  })

  it('returns null when Google rejects the token', async () => {
    const { resolveEmail } = await loadResolveEmail()
    mockVerifyIdToken.mockRejectedValue(new Error('invalid token'))
    expect(await resolveEmail('Bearer garbage')).toBeNull()
  })

  it('returns null when the Google payload is unverified', async () => {
    const { resolveEmail } = await loadResolveEmail()
    mockVerifyIdToken.mockResolvedValue(googlePayload({ email_verified: false, email: 'x@y.com' }))
    expect(await resolveEmail('Bearer unverified')).toBeNull()
  })

  it('skips session-JWT verification entirely when no secret is configured', async () => {
    const { resolveEmail } = await loadResolveEmail({ secret: '' })
    // A string that would be a valid JWT under SECRET is treated as a
    // Google token instead, because session tokens are disabled here.
    const token = signSessionToken('alice@acme.com', SECRET, Math.floor(Date.now() / 1000), TTL)
    mockVerifyIdToken.mockResolvedValue(googlePayload({ email_verified: true, email: 'google@acme.com' }))
    expect(await resolveEmail(`Bearer ${token}`)).toBe('google@acme.com')
    expect(mockVerifyIdToken).toHaveBeenCalledOnce()
  })
})
