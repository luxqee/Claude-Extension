import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'
import { resolveEmail } from '../../lib/resolve-email.js'
import { resolveDirectorContext } from '../../lib/require-director.js'
import { canDeleteTab, pickFallbackTabId } from '../../lib/org-tab-helpers.js'

const sql = neon(process.env.DATABASE_URL ?? '')

// PATCH  /api/org-tabs/:id  { name?, emoji? }   (director-only) -> 204 | 404
// DELETE /api/org-tabs/:id                       (director-only) -> 204 | 400 (last tab) | 404
// On DELETE, this tab's prompts move to the org's first remaining tab.

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const tabId = req.query.id
  if (typeof tabId !== 'string') {
    res.status(400).json({ error: 'invalid tab id' })
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

    const tabs = (await sql`
      SELECT id FROM org_tabs WHERE org_id = ${director.orgId} ORDER BY sort_order ASC
    `) as { id: string }[]
    if (!tabs.some((t) => t.id === tabId)) {
      res.status(404).json({ error: 'tab not found' })
      return
    }

    if (req.method === 'DELETE') {
      if (!canDeleteTab(tabs.length)) {
        res.status(400).json({ error: 'cannot delete the last tab' })
        return
      }
      const fallbackTabId = pickFallbackTabId(tabs, tabId)
      await sql.transaction([
        sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
        sql`UPDATE prompts SET tab_id = ${fallbackTabId} WHERE org_id = ${director.orgId} AND tab_id = ${tabId}`,
        sql`DELETE FROM org_tabs WHERE id = ${tabId} AND org_id = ${director.orgId}`,
      ])
      res.status(204).end()
      return
    }

    // PATCH
    const body = req.body as { name?: unknown; emoji?: unknown }
    const updates: { name?: string; emoji?: string | null } = {}
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        res.status(400).json({ error: 'name must be a non-empty string' })
        return
      }
      updates.name = body.name.trim()
    }
    if (body.emoji !== undefined) {
      updates.emoji =
        typeof body.emoji === 'string' && body.emoji.trim().length > 0 ? body.emoji.trim().slice(0, 8) : null
    }
    if (updates.name === undefined && updates.emoji === undefined) {
      res.status(400).json({ error: 'no fields to update' })
      return
    }

    await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
      sql`UPDATE org_tabs SET
            name = COALESCE(${updates.name ?? null}, name),
            emoji = CASE WHEN ${updates.emoji !== undefined} THEN ${updates.emoji ?? null} ELSE emoji END
          WHERE id = ${tabId} AND org_id = ${director.orgId}`,
    ])
    res.status(204).end()
  } catch (error) {
    console.error('[org-tabs/:id] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
