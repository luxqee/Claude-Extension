import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'
import { resolveEmail } from '../lib/resolve-email.js'

const sql = neon(process.env.DATABASE_URL ?? '')

// POST /api/prompt-run  { promptId }   (any active member)
//
// Records one run of a shared prompt: bumps the lifetime (prompt, member)
// counter and today's org-wide total, and prunes daily rows older than
// 30 days so org_daily_runs stays small. Fire-and-forget from the client
// -- a failure here must never block inserting the prompt.

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

  const body = req.body as { promptId?: unknown }
  if (typeof body.promptId !== 'string' || body.promptId.length === 0) {
    res.status(400).json({ error: 'promptId is required' })
    return
  }
  const promptId = body.promptId

  try {
    // Oldest active membership wins, mirroring org-session / usage-report.
    const memberRows = (await sql`
      SELECT org_id FROM org_members
      WHERE lower(email) = lower(${email}) AND status = 'active'
      ORDER BY created_at ASC LIMIT 1
    `) as { org_id: string }[]
    const orgId = memberRows[0]?.org_id
    if (!orgId) {
      res.status(403).json({ error: 'not an active organization member' })
      return
    }

    const promptRows = (await sql`
      SELECT 1 FROM prompts WHERE id = ${promptId} AND org_id = ${orgId}
    `) as unknown[]
    if (promptRows.length === 0) {
      res.status(404).json({ error: 'prompt not found in this organization' })
      return
    }

    await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${orgId}, true)`,
      sql`
        INSERT INTO org_prompt_usage (org_id, prompt_id, email, run_count, last_used_at)
        VALUES (${orgId}, ${promptId}, ${email}, 1, now())
        ON CONFLICT (org_id, prompt_id, email)
        DO UPDATE SET run_count = org_prompt_usage.run_count + 1, last_used_at = now()
      `,
      sql`
        INSERT INTO org_daily_runs (org_id, day, run_count)
        VALUES (${orgId}, current_date, 1)
        ON CONFLICT (org_id, day) DO UPDATE SET run_count = org_daily_runs.run_count + 1
      `,
      sql`DELETE FROM org_daily_runs WHERE org_id = ${orgId} AND day < current_date - interval '30 days'`,
    ])

    res.status(204).end()
  } catch (error) {
    console.error('[prompt-run] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
