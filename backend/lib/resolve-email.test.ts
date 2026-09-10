import { describe, expect, it, vi, beforeEach } from 'vitest'
import { signSessionToken } from './jwt'

const { mockVerifyClerk } = vi.hoisted(() => ({ mockVerifyClerk: vi.fn() }))

vi.mock('./verify-clerk.js', () => ({ verifyClerkToken: mockVerifyClerk }))

const SECRET = 'resolve-email-unit-secret'
const TTL = 14 * 24 * 60 * 60

async function loadResolveEmail(env: { secret?: string } = {}) {
  vi.resetModules()
  process.env.SESSION_JWT_SECRET = env.secret ?? SECRET
  return import('./resolve-email')
}

describe('resolveEmail', () => {
  beforeEach(() => {
    mockVerifyClerk.mockReset()
  })

  it('returns null when the header is missing or not a Bearer token', async () => {
    const { resolveEmail } = await loadResolveEmail()
    expect(await resolveEmail(undefined)).toBeNull()
    expect(await resolveEmail('')).toBeNull()
    expect(await resolveEmail('Basic abc')).toBeNull()
    expect(await resolveEmail('Bearer ')).toBeNull()
    expect(mockVerifyClerk).not.toHaveBeenCalled()
  })

  it('resolves a valid session JWT locally without calling the provider', async () => {
    const { resolveEmail } = await loadResolveEmail()
    const token = signSessionToken('alice@acme.com', SECRET, Math.floor(Date.now() / 1000), TTL)
    expect(await resolveEmail(`Bearer ${token}`)).toBe('alice@acme.com')
    expect(mockVerifyClerk).not.toHaveBeenCalled()
  })

  it('falls back to Clerk verification when the token is not a session JWT', async () => {
    const { resolveEmail } = await loadResolveEmail()
    mockVerifyClerk.mockResolvedValue('bob@acme.com')
    expect(await resolveEmail('Bearer a-clerk-id-token')).toBe('bob@acme.com')
    expect(mockVerifyClerk).toHaveBeenCalledOnce()
  })

  it('falls back to Clerk when the session JWT is expired', async () => {
    const { resolveEmail } = await loadResolveEmail()
    const expired = signSessionToken('old@acme.com', SECRET, Math.floor(Date.now() / 1000) - TTL - 10, TTL)
    mockVerifyClerk.mockResolvedValue('fresh@acme.com')
    expect(await resolveEmail(`Bearer ${expired}`)).toBe('fresh@acme.com')
    expect(mockVerifyClerk).toHaveBeenCalledOnce()
  })

  it('returns null when Clerk rejects the token', async () => {
    const { resolveEmail } = await loadResolveEmail()
    mockVerifyClerk.mockResolvedValue(null)
    expect(await resolveEmail('Bearer garbage')).toBeNull()
  })

  it('skips session-JWT verification entirely when no secret is configured', async () => {
    const { resolveEmail } = await loadResolveEmail({ secret: '' })
    const token = signSessionToken('alice@acme.com', SECRET, Math.floor(Date.now() / 1000), TTL)
    mockVerifyClerk.mockResolvedValue('clerk@acme.com')
    expect(await resolveEmail(`Bearer ${token}`)).toBe('clerk@acme.com')
    expect(mockVerifyClerk).toHaveBeenCalledOnce()
  })
})
