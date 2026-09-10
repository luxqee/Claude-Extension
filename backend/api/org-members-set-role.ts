import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'
import { resolveEmail } from '../lib/resolve-email.js'
import { resolveDirectorContext } from '../lib/require-director.js'
import { isLastActiveDirector } from '../lib/last-director-guard.js'

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

  const body = req.body as { email?: unknown; role?: unknown }
  if (typeof body.email !== 'string' || body.email.trim().length === 0) {
    res.status(400).json({ error: 'email is required' })
    return
  }
  if (body.role !== 'director' && body.role !== 'member') {
    res.status(400).json({ error: 'role must be "director" or "member"' })
    return
  }
  const targetEmail = body.email.trim()
  const newRole = body.role

  try {
    const director = await resolveDirectorContext(sql, callerEmail)
    if (!director) {
      res.status(403).json({ error: 'not a director' })
      return
    }

    const targetRows = (await sql`
      SELECT role, status FROM org_members WHERE org_id = ${director.orgId} AND lower(email) = lower(${targetEmail})
    `) as { role: 'director' | 'member'; status: 'pending' | 'active' }[]
    const target = targetRows[0]
    if (!target) {
      res.status(404).json({ error: 'member not found' })
      return
    }

    if (newRole === 'member' && target.role === 'director') {
      const otherDirectorRows = (await sql`
        SELECT count(*)::int AS count FROM org_members
        WHERE org_id = ${director.orgId} AND role = 'director' AND status = 'active' AND lower(email) != lower(${targetEmail})
      `) as { count: number }[]
      if (isLastActiveDirector(target, otherDirectorRows[0]?.count ?? 0)) {
        res.status(400).json({ error: 'cannot demote the last admin' })
        return
      }
    }

    // Promoting a still-pending member to director implies approving them
    // too -- there is no separate "approve" click required in this case.
    await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
      sql`UPDATE org_members SET role = ${newRole}, status = 'active' WHERE org_id = ${director.orgId} AND lower(email) = lower(${targetEmail})`,
    ])

    res.status(204).end()
  } catch (error) {
    console.error('[org-members-set-role] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
