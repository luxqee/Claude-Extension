import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'
import { resolveEmail } from '../lib/resolve-email.js'

const sql = neon(process.env.DATABASE_URL ?? '')

const INVALID_PERCENT = Symbol('invalid percent')

// usage_snapshots' percent columns are `integer`, but claude.ai's own
// percentages are fractional. The extension rounds before sending; round
// again here so an unrounded value from any other caller is accepted and
// stored rather than blowing up as a Postgres type error surfaced as an
// opaque 500. Anything that is not a finite number in [0, 100] (or null)
// is still a 400.
function normalizePercent(value: unknown): number | null | typeof INVALID_PERCENT {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    return INVALID_PERCENT
  }
  return Math.round(value)
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const email = await resolveEmail(req.headers.authorization)
  if (!email) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  const body = req.body as { sessionPercent?: unknown; weeklyPercent?: unknown; spendPercent?: unknown }
  const sessionPercent = normalizePercent(body.sessionPercent)
  const weeklyPercent = normalizePercent(body.weeklyPercent)
  const spendPercent = normalizePercent(body.spendPercent)
  if (
    sessionPercent === INVALID_PERCENT ||
    weeklyPercent === INVALID_PERCENT ||
    spendPercent === INVALID_PERCENT
  ) {
    res.status(400).json({ error: 'percent fields must be a number between 0 and 100, or null' })
    return
  }

  try {
    // Oldest active membership wins, matching org-session.ts: a director of
    // another org can add any email as an active member, and picking the
    // newest row would let that redirect an existing member's usage reports
    // into the newly-added org.
    const memberRows = (await sql`
      SELECT org_id FROM org_members
      WHERE lower(email) = lower(${email}) AND status = 'active'
      ORDER BY created_at ASC LIMIT 1
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
        VALUES (${membership.org_id}, ${email.toLowerCase()}, ${sessionPercent}, ${weeklyPercent}, ${spendPercent}, now())
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
