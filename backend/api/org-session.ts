import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { neon } from '@neondatabase/serverless'
import { type OrgRecord } from '../lib/resolve-org.js'
import { resolveSessionState, type OrgMemberRecord } from '../lib/resolve-session.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
const sql = neon(process.env.DATABASE_URL ?? '')
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID)

interface OrgRow extends OrgRecord {
  name: string
}

interface MemberRow {
  org_id: string
  email: string
  role: 'director' | 'member'
  status: 'pending' | 'active'
}

async function verifyEmail(idToken: string): Promise<string | null> {
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()
    if (!payload?.email_verified) return null
    return payload.email ?? null
  } catch (error) {
    console.error('[org-session] token verification failed', error)
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

  const email = await verifyEmail(idToken)
  if (!email) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  try {
    const [orgs, memberRows] = await Promise.all([
      sql`SELECT id, name, domain FROM organizations` as unknown as Promise<OrgRow[]>,
      sql`SELECT org_id, email, role, status FROM org_members WHERE lower(email) = lower(${email}) ORDER BY created_at DESC LIMIT 1` as unknown as Promise<
        MemberRow[]
      >,
    ])

    const existingMember: OrgMemberRecord | null = memberRows[0]
      ? {
          orgId: memberRows[0].org_id,
          email: memberRows[0].email,
          role: memberRows[0].role,
          status: memberRows[0].status,
        }
      : null

    const resolution = resolveSessionState(email, existingMember, orgs)

    if (resolution.state === 'needs_onboarding') {
      res.status(200).json({ state: 'needs_onboarding' })
      return
    }

    if (resolution.state === 'active') {
      const org = orgs.find((candidate) => candidate.id === resolution.orgId)
      res.status(200).json({
        state: 'active',
        org: { id: resolution.orgId, name: org?.name ?? '' },
        role: resolution.role,
      })
      return
    }

    // state === 'pending'. If there was no existing row, this is a
    // brand-new domain auto-join -- create the pending row now.
    if (!existingMember) {
      await sql`
        INSERT INTO org_members (org_id, email, role, status)
        VALUES (${resolution.orgId}, ${email}, 'member', 'pending')
        ON CONFLICT (org_id, email) DO NOTHING
      `
    }
    const org = orgs.find((candidate) => candidate.id === resolution.orgId)
    res.status(200).json({ state: 'pending', org: { id: resolution.orgId, name: org?.name ?? '' } })
  } catch (error) {
    console.error('[org-session] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
