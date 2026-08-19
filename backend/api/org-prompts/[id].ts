import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { neon } from '@neondatabase/serverless'
import { resolveDirectorContext } from '../../lib/require-director.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
const sql = neon(process.env.DATABASE_URL ?? '')
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID)

async function verifyEmail(idToken: string): Promise<string | null> {
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()
    if (!payload?.email_verified) return null
    return payload.email ?? null
  } catch (error) {
    console.error('[org-prompts/:id] token verification failed', error)
    return null
  }
}

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

  const authHeader = req.headers.authorization
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!idToken) {
    res.status(401).json({ error: 'missing token' })
    return
  }

  const email = await verifyEmail(idToken)
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
    const body = req.body as { name?: unknown; promptText?: unknown; type?: unknown }
    const updates: { name?: string; prompt_text?: string; type?: 'prompt' | 'skill' } = {}
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
          type = COALESCE(${updates.type ?? null}, type)
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
