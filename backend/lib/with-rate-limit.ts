import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { NeonQueryFunction } from '@neondatabase/serverless'
import { checkRateLimit, clientIp } from './rate-limit.js'

type Sql = NeonQueryFunction<false, false>
type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>

/**
 * Wraps a route handler with a per-IP rate limit, checked BEFORE the
 * handler runs at all -- including before it verifies the caller's token.
 * A flood of requests carrying garbage or expired tokens still costs a
 * JWT/JWKS verification each; without this, that cost (and the Vercel
 * invocation count) is uncapped for any route that hasn't rolled its own
 * limit. `auth/session`, `org-onboarding`, `prompt-run` and
 * `usage-report` already have their own tighter, per-caller-keyed limits
 * (some by email, chosen for their specific abuse shape) and don't need
 * this too; every other authenticated route does.
 */
export function withRateLimit(sql: Sql, routeName: string, limit: number, windowSeconds: number) {
  return (handler: Handler): Handler =>
    async (req, res) => {
      const ip = clientIp(req.headers['x-forwarded-for'])
      const result = await checkRateLimit(sql, `${routeName}:${ip}`, limit, windowSeconds)
      if (!result.ok) {
        res.setHeader('Retry-After', String(result.retryAfter))
        res.status(429).json({ error: 'too many requests' })
        return
      }
      return handler(req, res)
    }
}
