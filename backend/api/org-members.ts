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

  const callerEmail = await resolveEmail(req.headers.authorization)
  if (!callerEmail) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  try {
    const director = await resolveDirectorContext(sql, callerEmail)
    if (!director) {
      res.status(403).json({ error: 'not a director' })
      return
    }

    const results = await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
      sql`SELECT email, role, status, created_at FROM org_members WHERE org_id = ${director.orgId} ORDER BY created_at ASC`,
    ])
    const members = results[1] as { email: string; role: string; status: string; created_at: string }[]

    res.status(200).json({
      members: members.map((m) => ({ email: m.email, role: m.role, status: m.status, createdAt: m.created_at })),
    })
  } catch (error) {
    console.error('[org-members] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
