import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { neon } from '@neondatabase/serverless'
import { resolveDirectorContext } from '../lib/require-director.js'

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
    console.error('[org-usage] token verification failed', error)
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
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

  try {
    const director = await resolveDirectorContext(sql, email)
    if (!director) {
      res.status(403).json({ error: 'not a director' })
      return
    }

    const results = await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
      sql`SELECT email, session_percent, weekly_percent, spend_percent, updated_at FROM usage_snapshots WHERE org_id = ${director.orgId}`,
    ])
    const snapshots = results[1] as {
      email: string
      session_percent: number | null
      weekly_percent: number | null
      spend_percent: number | null
      updated_at: string
    }[]

    res.status(200).json({
      snapshots: snapshots.map((s) => ({
        email: s.email,
        sessionPercent: s.session_percent,
        weeklyPercent: s.weekly_percent,
        spendPercent: s.spend_percent,
        updatedAt: s.updated_at,
      })),
    })
  } catch (error) {
    console.error('[org-usage] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
