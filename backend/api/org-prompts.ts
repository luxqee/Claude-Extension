import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'
import { resolveEmail } from '../lib/resolve-email.js'
import { resolveDirectorContext } from '../lib/require-director.js'
import { nextSortOrder } from '../lib/org-tab-helpers.js'

const sql = neon(process.env.DATABASE_URL ?? '')

interface OrgRow {
  id: string
  name: string
}

interface PromptRow {
  id: string
  name: string
  prompt_text: string
  type: 'prompt' | 'skill'
  tab_id: string | null
  sort_order: number
}

interface TabRow {
  id: string
  name: string
  emoji: string | null
  sort_order: number
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const email = await resolveEmail(req.headers.authorization)
  if (!email) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  if (req.method === 'POST') {
    const body = req.body as { name?: unknown; promptText?: unknown; type?: unknown; tabId?: unknown }
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      res.status(400).json({ error: 'name is required' })
      return
    }
    if (typeof body.promptText !== 'string' || body.promptText.trim().length === 0) {
      res.status(400).json({ error: 'promptText is required' })
      return
    }
    if (body.type !== 'prompt' && body.type !== 'skill') {
      res.status(400).json({ error: 'type must be "prompt" or "skill"' })
      return
    }
    const requestedTabId = typeof body.tabId === 'string' ? body.tabId : null

    try {
      const director = await resolveDirectorContext(sql, email)
      if (!director) {
        res.status(403).json({ error: 'not a director' })
        return
      }

      // Resolve the target tab: the requested one if it belongs to this
      // org, else the org's first tab by sort_order, creating a "General"
      // tab if the org somehow has none.
      const tabRows = (await sql`
        SELECT id, sort_order FROM org_tabs WHERE org_id = ${director.orgId} ORDER BY sort_order ASC
      `) as { id: string; sort_order: number }[]
      let targetTabId = tabRows.find((t) => t.id === requestedTabId)?.id ?? tabRows[0]?.id ?? null
      if (!targetTabId) {
        const created = (await sql`
          INSERT INTO org_tabs (org_id, name, sort_order) VALUES (${director.orgId}, 'General', 0)
          RETURNING id
        `) as { id: string }[]
        targetTabId = created[0].id
      }

      const promptSortOrder = nextSortOrder(
        ((await sql`
          SELECT sort_order FROM prompts WHERE org_id = ${director.orgId} AND tab_id = ${targetTabId}
        `) as { sort_order: number }[]).map((r) => r.sort_order),
      )

      await sql.transaction([
        sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
        sql`INSERT INTO prompts (org_id, name, prompt_text, type, tab_id, sort_order)
            VALUES (${director.orgId}, ${body.name.trim()}, ${body.promptText.trim()}, ${body.type}, ${targetTabId}, ${promptSortOrder})`,
      ])

      res.status(201).json({ ok: true })
    } catch (error) {
      console.error('[org-prompts] create failed', error)
      res.status(500).json({ error: 'internal error' })
    }
    return
  }

  try {
    // Resolve the caller's org from their real membership, NOT from
    // email-domain matching -- mirrors org-session.ts, oldest-membership-wins.
    const memberRows = (await sql`
      SELECT org_id FROM org_members
      WHERE lower(email) = lower(${email}) AND status = 'active'
      ORDER BY created_at ASC LIMIT 1
    `) as { org_id: string }[]
    const orgId = memberRows[0]?.org_id

    if (!orgId) {
      res.status(200).json({ org: null, tabs: [], prompts: [] })
      return
    }

    const orgRows = (await sql`SELECT id, name FROM organizations WHERE id = ${orgId}`) as OrgRow[]
    const org = orgRows[0]
    if (!org) {
      res.status(200).json({ org: null, tabs: [], prompts: [] })
      return
    }

    const results = await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${orgId}, true)`,
      sql`SELECT id, name, emoji, sort_order FROM org_tabs WHERE org_id = ${orgId} ORDER BY sort_order ASC`,
      sql`SELECT id, name, prompt_text, type, tab_id, sort_order FROM prompts WHERE org_id = ${orgId} ORDER BY sort_order ASC`,
    ])
    const tabs = results[1] as TabRow[]
    const prompts = results[2] as PromptRow[]

    res.status(200).json({
      org: { name: org.name },
      tabs: tabs.map((t) => ({ id: t.id, name: t.name, emoji: t.emoji, sort_order: t.sort_order })),
      prompts: prompts.map((p) => ({
        id: p.id,
        name: p.name,
        prompt_text: p.prompt_text,
        type: p.type,
        tab_id: p.tab_id,
        sort_order: p.sort_order,
      })),
    })
  } catch (error) {
    console.error('[org-prompts] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
