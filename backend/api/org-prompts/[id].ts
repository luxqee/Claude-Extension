import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'
import { resolveEmail } from '../../lib/resolve-email.js'
import { resolveDirectorContext } from '../../lib/require-director.js'
import { nextSortOrder } from '../../lib/org-tab-helpers.js'

const sql = neon(process.env.DATABASE_URL ?? '')

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const promptId = req.query.id
  if (typeof promptId !== 'string') {
    res.status(400).json({ error: 'invalid prompt id' })
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

    if (req.method === 'DELETE') {
      // RETURNING id is how many rows actually matched -- the neon client is
      // configured without full results, so a bare DELETE gives no row count
      // and a prompt belonging to another org (or no prompt at all) would
      // otherwise report success while changing nothing.
      const results = await sql.transaction([
        sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
        sql`DELETE FROM prompts WHERE id = ${promptId} AND org_id = ${director.orgId} RETURNING id`,
      ])
      const deleted = results[1] as { id: string }[]
      if (deleted.length === 0) {
        res.status(404).json({ error: 'prompt not found' })
        return
      }
      res.status(204).end()
      return
    }

    // PATCH
    const body = req.body as { name?: unknown; promptText?: unknown; type?: unknown; tabId?: unknown }
    const updates: {
      name?: string
      prompt_text?: string
      type?: 'prompt' | 'skill'
      tab_id?: string
      sort_order?: number
    } = {}
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        res.status(400).json({ error: 'name must be a non-empty string' })
        return
      }
      updates.name = body.name.trim()
    }
    if (body.promptText !== undefined) {
      if (typeof body.promptText !== 'string' || body.promptText.trim().length === 0) {
        res.status(400).json({ error: 'promptText must be a non-empty string' })
        return
      }
      updates.prompt_text = body.promptText.trim()
    }
    if (body.type !== undefined) {
      if (body.type !== 'prompt' && body.type !== 'skill') {
        res.status(400).json({ error: 'type must be "prompt" or "skill"' })
        return
      }
      updates.type = body.type
    }
    if (body.tabId !== undefined) {
      if (typeof body.tabId !== 'string') {
        res.status(400).json({ error: 'tabId must be a string' })
        return
      }
      const tabRows = (await sql`
        SELECT id FROM org_tabs WHERE id = ${body.tabId} AND org_id = ${director.orgId}
      `) as { id: string }[]
      if (tabRows.length === 0) {
        res.status(400).json({ error: 'tabId is not a tab of this organisation' })
        return
      }
      updates.tab_id = body.tabId
      updates.sort_order = nextSortOrder(
        ((await sql`
          SELECT sort_order FROM prompts WHERE org_id = ${director.orgId} AND tab_id = ${body.tabId}
        `) as { sort_order: number }[]).map((r) => r.sort_order),
      )
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'no fields to update' })
      return
    }

    const results = await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
      sql`
        UPDATE prompts SET
          name = COALESCE(${updates.name ?? null}, name),
          prompt_text = COALESCE(${updates.prompt_text ?? null}, prompt_text),
          type = COALESCE(${updates.type ?? null}, type),
          tab_id = COALESCE(${updates.tab_id ?? null}, tab_id),
          sort_order = COALESCE(${updates.sort_order ?? null}, sort_order)
        WHERE id = ${promptId} AND org_id = ${director.orgId}
        RETURNING id
      `,
    ])
    const updated = results[1] as { id: string }[]
    if (updated.length === 0) {
      res.status(404).json({ error: 'prompt not found' })
      return
    }
    res.status(204).end()
  } catch (error) {
    console.error('[org-prompts/:id] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
