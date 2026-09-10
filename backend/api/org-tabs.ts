import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'
import { resolveEmail } from '../lib/resolve-email.js'
import { resolveDirectorContext } from '../lib/require-director.js'
import { nextSortOrder } from '../lib/org-tab-helpers.js'

const sql = neon(process.env.DATABASE_URL ?? '')

// POST /api/org-tabs  { name, emoji? }   (director-only) -> 201
// Listing org tabs is folded into GET /api/org-prompts.

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

  const body = req.body as { name?: unknown; emoji?: unknown }
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const emoji =
    typeof body.emoji === 'string' && body.emoji.trim().length > 0 ? body.emoji.trim().slice(0, 8) : null

  try {
    const director = await resolveDirectorContext(sql, email)
    if (!director) {
      res.status(403).json({ error: 'not a director' })
      return
    }

    const orders = (await sql`
      SELECT sort_order FROM org_tabs WHERE org_id = ${director.orgId}
    `) as { sort_order: number }[]
    const sortOrder = nextSortOrder(orders.map((r) => r.sort_order))

    await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
      sql`INSERT INTO org_tabs (org_id, name, emoji, sort_order)
          VALUES (${director.orgId}, ${body.name.trim()}, ${emoji}, ${sortOrder})`,
    ])

    res.status(201).json({ ok: true })
  } catch (error) {
    console.error('[org-tabs] create failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
