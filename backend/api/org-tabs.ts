import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'
import { resolveEmail } from '../lib/resolve-email.js'
import { resolveDirectorContext } from '../lib/require-director.js'
import { nextSortOrder, canDeleteTab, pickFallbackTabId, applyTabReorder } from '../lib/org-tab-helpers.js'

const sql = neon(process.env.DATABASE_URL ?? '')

// All shared-tab writes, director-only. Listing tabs is folded into
// GET /api/org-prompts.
//
//   POST   /api/org-tabs            { name, emoji? }                 -> 201
//   POST   /api/org-tabs            { action: "reorder", orderedIds } -> 204
//   PATCH  /api/org-tabs?id=<id>    { name?, emoji? }                -> 204 | 404
//   DELETE /api/org-tabs?id=<id>                                     -> 204 | 400 (last tab) | 404
//
// (org-tabs/[id] and org-tabs-reorder were folded in here to stay under
// Vercel's 12-function Hobby cap.)

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST' && req.method !== 'PATCH' && req.method !== 'DELETE') {
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
    const tabId = typeof req.query.id === 'string' ? req.query.id : null

    if (req.method === 'POST') {
      const body = req.body as { name?: unknown; emoji?: unknown; action?: unknown; orderedIds?: unknown }

      if (body.action === 'reorder') {
        if (!Array.isArray(body.orderedIds) || !body.orderedIds.every((x) => typeof x === 'string')) {
          res.status(400).json({ error: 'orderedIds must be an array of strings' })
          return
        }
        const current = (await sql`
          SELECT id FROM org_tabs WHERE org_id = ${orgId} ORDER BY sort_order ASC
        `) as { id: string }[]
        const finalOrder = applyTabReorder(
          current.map((t) => t.id),
          body.orderedIds as string[],
        )
        await sql.transaction([
          sql`SELECT set_config('app.current_org_id', ${orgId}, true)`,
          ...finalOrder.map(
            (id, index) =>
              sql`UPDATE org_tabs SET sort_order = ${index} WHERE id = ${id} AND org_id = ${orgId}`,
          ),
        ])
        res.status(204).end()
        return
      }

      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        res.status(400).json({ error: 'name is required' })
        return
      }
      const emoji =
        typeof body.emoji === 'string' && body.emoji.trim().length > 0 ? body.emoji.trim().slice(0, 8) : null
      const orders = (await sql`
        SELECT sort_order FROM org_tabs WHERE org_id = ${orgId}
      `) as { sort_order: number }[]
      await sql.transaction([
        sql`SELECT set_config('app.current_org_id', ${orgId}, true)`,
        sql`INSERT INTO org_tabs (org_id, name, emoji, sort_order)
            VALUES (${orgId}, ${body.name.trim()}, ${emoji}, ${nextSortOrder(orders.map((r) => r.sort_order))})`,
      ])
      res.status(201).json({ ok: true })
      return
    }

    // PATCH / DELETE need ?id=
    if (!tabId) {
      res.status(400).json({ error: 'tab id is required' })
      return
    }
    const tabs = (await sql`
      SELECT id FROM org_tabs WHERE org_id = ${orgId} ORDER BY sort_order ASC
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
        sql`SELECT set_config('app.current_org_id', ${orgId}, true)`,
        sql`UPDATE prompts SET tab_id = ${fallbackTabId} WHERE org_id = ${orgId} AND tab_id = ${tabId}`,
        sql`DELETE FROM org_tabs WHERE id = ${tabId} AND org_id = ${orgId}`,
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
      sql`SELECT set_config('app.current_org_id', ${orgId}, true)`,
      sql`UPDATE org_tabs SET
            name = COALESCE(${updates.name ?? null}, name),
            emoji = CASE WHEN ${updates.emoji !== undefined} THEN ${updates.emoji ?? null} ELSE emoji END
          WHERE id = ${tabId} AND org_id = ${orgId}`,
    ])
    res.status(204).end()
  } catch (error) {
    console.error('[org-tabs] request failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
