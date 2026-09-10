import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'
import { resolveEmail } from '../lib/resolve-email.js'
import { resolveDirectorContext } from '../lib/require-director.js'
import { applyTabReorder } from '../lib/org-tab-helpers.js'

const sql = neon(process.env.DATABASE_URL ?? '')

// POST /api/org-tabs-reorder  { orderedIds: string[] }   (director-only) -> 204

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

  const body = req.body as { orderedIds?: unknown }
  if (!Array.isArray(body.orderedIds) || !body.orderedIds.every((id) => typeof id === 'string')) {
    res.status(400).json({ error: 'orderedIds must be an array of strings' })
    return
  }
  const requestedOrder = body.orderedIds as string[]

  try {
    const director = await resolveDirectorContext(sql, email)
    if (!director) {
      res.status(403).json({ error: 'not a director' })
      return
    }

    const current = (await sql`
      SELECT id FROM org_tabs WHERE org_id = ${director.orgId} ORDER BY sort_order ASC
    `) as { id: string }[]

    const finalOrder = applyTabReorder(
      current.map((t) => t.id),
      requestedOrder,
    )

    await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
      ...finalOrder.map(
        (id, index) =>
          sql`UPDATE org_tabs SET sort_order = ${index} WHERE id = ${id} AND org_id = ${director.orgId}`,
      ),
    ])

    res.status(204).end()
  } catch (error) {
    console.error('[org-tabs-reorder] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
