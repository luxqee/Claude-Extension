import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { neon } from '@neondatabase/serverless'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
const sql = neon(process.env.DATABASE_URL ?? '')
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID)

async function verifyEmail(idToken: string): Promise<string | null> {
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()
    if (!payload?.email_verified) return null
    return payload.email ?? null
  } catch (error) {
    console.error('[usage-report] token verification failed', error)
    return null
  }
}

function isPercentOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && value >= 0 && value <= 100)
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const authHeader = req.headers.authorization
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!idToken) {
    res.status(401).json({ error: 'missing token' })
    return
  }

  const email = await verifyEmail(idToken)
  if (!email) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  const body = req.body as { sessionPercent?: unknown; weeklyPercent?: unknown; spendPercent?: unknown }
  if (
    !isPercentOrNull(body.sessionPercent) ||
    !isPercentOrNull(body.weeklyPercent) ||
    !isPercentOrNull(body.spendPercent)
  ) {
    res.status(400).json({ error: 'percent fields must be a number between 0 and 100, or null' })
    return
  }

  try {
    const memberRows = (await sql`
      SELECT org_id FROM org_members
      WHERE lower(email) = lower(${email}) AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `) as { org_id: string }[]
    const membership = memberRows[0]
    if (!membership) {
      res.status(403).json({ error: 'not an active organization member' })
      return
    }

    await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${membership.org_id}, true)`,
      sql`
        INSERT INTO usage_snapshots (org_id, email, session_percent, weekly_percent, spend_percent, updated_at)
        VALUES (${membership.org_id}, ${email}, ${body.sessionPercent}, ${body.weeklyPercent}, ${body.spendPercent}, now())
        ON CONFLICT (org_id, email) DO UPDATE SET
          session_percent = excluded.session_percent,
          weekly_percent = excluded.weekly_percent,
          spend_percent = excluded.spend_percent,
          updated_at = now()
      `,
    ])

    res.status(204).end()
  } catch (error) {
    console.error('[usage-report] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
