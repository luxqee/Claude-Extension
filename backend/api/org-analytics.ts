import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'
import { resolveEmail } from '../lib/resolve-email.js'
import { resolveDirectorContext } from '../lib/require-director.js'
import { withRateLimit } from '../lib/with-rate-limit.js'

const sql = neon(process.env.DATABASE_URL ?? '')

// GET /api/org-analytics   (director-only)
//
// 200 -> {
//   topPrompts: [ { promptId, name, runCount } ],   // every shared prompt, zero-run included
//   perMember:  [ { email, runCount, lastUsedAt } ],
//   dailyRuns:  [ { day, runCount } ]                // last 30 days, org-wide total
// }

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
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
    const orgId = director.orgId

    const results = await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${orgId}, true)`,
      sql`
        SELECT p.id AS prompt_id, p.name, COALESCE(SUM(u.run_count), 0)::int AS run_count
        FROM prompts p
        LEFT JOIN org_prompt_usage u ON u.prompt_id = p.id AND u.org_id = ${orgId}
        WHERE p.org_id = ${orgId}
        GROUP BY p.id, p.name
        ORDER BY run_count DESC, p.name ASC
      `,
      sql`
        SELECT email, SUM(run_count)::int AS run_count, MAX(last_used_at) AS last_used_at
        FROM org_prompt_usage
        WHERE org_id = ${orgId}
        GROUP BY email
        ORDER BY run_count DESC, email ASC
      `,
      sql`
        SELECT day, run_count
        FROM org_daily_runs
        WHERE org_id = ${orgId} AND day >= current_date - interval '30 days'
        ORDER BY day ASC
      `,
    ])

    const topPromptRows = results[1] as { prompt_id: string; name: string; run_count: number }[]
    const perMemberRows = results[2] as { email: string; run_count: number; last_used_at: string }[]
    const dailyRows = results[3] as { day: string; run_count: number }[]

    res.status(200).json({
      topPrompts: topPromptRows.map((r) => ({ promptId: r.prompt_id, name: r.name, runCount: r.run_count })),
      perMember: perMemberRows.map((r) => ({
        email: r.email,
        runCount: r.run_count,
        lastUsedAt: r.last_used_at,
      })),
      dailyRuns: dailyRows.map((r) => ({ day: r.day, runCount: r.run_count })),
    })
  } catch (error) {
    console.error('[org-analytics] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}

export default withRateLimit(sql, 'org-analytics', 30, 60)(handler)
