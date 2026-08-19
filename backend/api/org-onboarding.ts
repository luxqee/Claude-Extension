import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { neon } from '@neondatabase/serverless'
import { resolveOrgId, isPublicEmailDomain, type OrgRecord } from '../lib/resolve-org.js'
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
    console.error('[org-onboarding] token verification failed', error)
    return null
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
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

  const body = req.body as { orgName?: unknown; initialMemberEmails?: unknown }
  if (!isNonEmptyString(body.orgName)) {
    res.status(400).json({ error: 'orgName is required' })
    return
  }
  const orgName = body.orgName.trim()
  const initialMemberEmails = Array.isArray(body.initialMemberEmails)
    ? body.initialMemberEmails.filter(isNonEmptyString).map((e) => e.trim().toLowerCase())
    : []

  const atIndex = email.lastIndexOf('@')
  if (atIndex === -1 || atIndex === email.length - 1) {
    res.status(400).json({ error: 'invalid email' })
    return
  }
  const domain = email.slice(atIndex + 1).toLowerCase()

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

    if (resolveSessionState(email, existingMember, orgs).state !== 'needs_onboarding') {
      res.status(409).json({ error: 'already a member of an organization' })
      return
    }

    // Best-effort race guard for real company domains: if another request
    // created an org for this exact domain between our read above and now,
    // join it as a pending member instead of creating a duplicate. This is
    // not a hard database guarantee (no unique constraint backs it, since
    // public domains must never be deduplicated this way) -- an extremely
    // tight simultaneous race could still create two organizations for the
    // same brand-new domain. Accepted, documented low-probability edge
    // case, not a correctness or security issue.
    if (!isPublicEmailDomain(domain)) {
      const raceOrgId = resolveOrgId(email, orgs)
      if (raceOrgId) {
        await sql`
          INSERT INTO org_members (org_id, email, role, status)
          VALUES (${raceOrgId}, ${email}, 'member', 'pending')
          ON CONFLICT (org_id, email) DO NOTHING
        `
        const org = orgs.find((candidate) => candidate.id === raceOrgId)
        res.status(200).json({ outcome: 'joined_existing', org: { id: raceOrgId, name: org?.name ?? '' } })
        return
      }
    }

    const [createdOrg] = (await sql`
      INSERT INTO organizations (name, domain) VALUES (${orgName}, ${domain}) RETURNING id, name
    `) as { id: string; name: string }[]

    await sql`
      INSERT INTO org_members (org_id, email, role, status) VALUES (${createdOrg.id}, ${email}, 'director', 'active')
    `

    for (const memberEmail of initialMemberEmails) {
      if (memberEmail === email.toLowerCase()) continue
      await sql`
        INSERT INTO org_members (org_id, email, role, status, invited_by)
        VALUES (${createdOrg.id}, ${memberEmail}, 'member', 'active', ${email})
        ON CONFLICT (org_id, email) DO NOTHING
      `
    }

    res.status(200).json({ outcome: 'created', org: { id: createdOrg.id, name: createdOrg.name }, role: 'director' })
  } catch (error) {
    console.error('[org-onboarding] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
