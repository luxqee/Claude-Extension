import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'
import { resolveEmail } from '../lib/resolve-email.js'
import { resolveDirectorContext } from '../lib/require-director.js'

const sql = neon(process.env.DATABASE_URL ?? '')

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const email = await resolveEmail(req.headers.authorization)
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
