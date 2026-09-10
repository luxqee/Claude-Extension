import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// The handler turns an Authorization header into a verified email via
// these; stub them so the test never hits the network.
const { mockVerifyExternalToken, mockVerifyClerkToken } = vi.hoisted(() => ({
  mockVerifyExternalToken: vi.fn(),
  mockVerifyClerkToken: vi.fn(),
}))

vi.mock('../../lib/resolve-email.js', () => ({
  extractBearerToken: (header: string | undefined) =>
    typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim() || null
      : null,
  verifyExternalToken: mockVerifyExternalToken,
}))

vi.mock('../../lib/verify-clerk.js', () => ({ verifyClerkToken: mockVerifyClerkToken }))

async function loadHandler() {
  vi.resetModules()
  process.env.SESSION_JWT_SECRET = 'session-handler-unit-secret'
  return (await import('./session.js')).default
}

function makeRes(): VercelResponse & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
    end() {
      return this
    },
  }
  return res as unknown as VercelResponse & { statusCode: number; body: unknown }
}

describe('POST /api/auth/session body handling', () => {
  beforeEach(() => {
    mockVerifyExternalToken.mockReset()
    mockVerifyClerkToken.mockReset()
  })

  it('does not 500 when the request has no body (the Google path)', async () => {
    const handler = await loadHandler()
    mockVerifyExternalToken.mockResolvedValue('user@acme.com')
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer good-google-id-token' },
      // body intentionally absent -- Vercel leaves req.body undefined for
      // a POST with no JSON payload.
    } as unknown as VercelRequest
    const res = makeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect((res.body as { email?: string }).email).toBe('user@acme.com')
  })

  it('still 401s a no-body request whose token does not verify', async () => {
    const handler = await loadHandler()
    mockVerifyExternalToken.mockResolvedValue(null)
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer garbage' },
    } as unknown as VercelRequest
    const res = makeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(401)
  })

  it('still routes to the Clerk code exchange when a body is present', async () => {
    const handler = await loadHandler()
    const req = {
      method: 'POST',
      headers: {},
      body: { code: 'abc', redirectUri: 'https://x.chromiumapp.org/', codeVerifier: 'v' },
    } as unknown as VercelRequest
    const res = makeRes()

    await handler(req, res)

    // CLERK_ISSUER / CLERK_OAUTH_CLIENT_ID are unset in the test env, so
    // clerkCodeToIdToken returns null and the handler answers 401 -- the
    // point is it took the code branch instead of throwing.
    expect(res.statusCode).toBe(401)
    expect((res.body as { error?: string }).error).toBe('code exchange failed')
  })
})
