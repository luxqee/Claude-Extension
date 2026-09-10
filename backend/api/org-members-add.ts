import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'
import { resolveEmail } from '../lib/resolve-email.js'
import { resolveDirectorContext } from '../lib/require-director.js'

const sql = neon(process.env.DATABASE_URL ?? '')

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const callerEmail = await resolveEmail(req.headers.authorization)
  if (!callerEmail) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  const body = req.body as { email?: unknown }
  if (typeof body.email !== 'string' || body.email.trim().length === 0) {
    res.status(400).json({ error: 'email is required' })
    return
  }
  const targetEmail = body.email.trim().toLowerCase()

  try {
    const director = await resolveDirectorContext(sql, callerEmail)
    if (!director) {
      res.status(403).json({ error: 'not a director' })
      return
    }

    await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
      sql`
        INSERT INTO org_members (org_id, email, role, status, invited_by)
        VALUES (${director.orgId}, ${targetEmail}, 'member', 'active', ${callerEmail})
        ON CONFLICT (org_id, lower(email)) DO UPDATE SET status = 'active'
      `,
    ])

    res.status(204).end()
  } catch (error) {
    console.error('[org-members-add] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
