import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { neon } from '@neondatabase/serverless'
import { resolveOrgId, type OrgRecord } from '../lib/resolve-org.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
const sql = neon(process.env.DATABASE_URL ?? '')
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID)

interface OrgRow extends OrgRecord {
  name: string
}

interface PromptRow {
  name: string
  prompt_text: string
  type: 'prompt' | 'skill'
}

async function verifyEmail(idToken: string): Promise<string | null> {
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()
    if (!payload?.email_verified) return null
    return payload.email ?? null
  } catch (error) {
    console.error('[org-prompts] token verification failed', error)
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' })
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
    const orgs = (await sql`SELECT id, name, domain FROM organizations`) as OrgRow[]
    const orgId = resolveOrgId(email, orgs)

    if (!orgId) {
      res.status(200).json({ org: null, prompts: [] })
      return
    }

    const org = orgs.find((candidate) => candidate.id === orgId)
    if (!org) {
      // resolveOrgId only returns ids present in `orgs`, so this is unreachable
      // in practice -- guarding anyway rather than asserting with `!`.
      res.status(200).json({ org: null, prompts: [] })
      return
    }

    const results = await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${orgId}, true)`,
      sql`SELECT name, prompt_text, type FROM prompts WHERE org_id = ${orgId}`,
    ])
    const prompts = results[1] as PromptRow[]

    res.status(200).json({
      org: { name: org.name },
      prompts: prompts.map((p) => ({ name: p.name, prompt_text: p.prompt_text, type: p.type })),
    })
  } catch (error) {
    console.error('[org-prompts] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
