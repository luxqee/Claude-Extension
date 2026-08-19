import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { neon } from '@neondatabase/serverless'
import { resolveDirectorContext } from '../lib/require-director.js'

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
    console.error('[org-members-approve] token verification failed', error)
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const authHeader = req.headers.authorization
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!idToken) {
    res.status(401).json({ error: 'missing token' })
    return
  }

  const callerEmail = await verifyEmail(idToken)
  if (!callerEmail) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  const body = req.body as { email?: unknown }
  if (typeof body.email !== 'string' || body.email.trim().length === 0) {
    res.status(400).json({ error: 'email is required' })
    return
  }
  const targetEmail = body.email.trim()

  try {
    const director = await resolveDirectorContext(sql, callerEmail)
    if (!director) {
      res.status(403).json({ error: 'not a director' })
      return
    }

    await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
      sql`UPDATE org_members SET status = 'active' WHERE org_id = ${director.orgId} AND lower(email) = lower(${targetEmail})`,
    ])

    res.status(204).end()
  } catch (error) {
    console.error('[org-members-approve] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
