import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'
import { resolveEmail } from '../lib/resolve-email.js'
import { resolveOrgId, isPublicEmailDomain, type OrgRecord } from '../lib/resolve-org.js'
import { resolveSessionState, type OrgMemberRecord } from '../lib/resolve-session.js'
import { checkRateLimit, clientIp } from '../lib/rate-limit.js'

const sql = neon(process.env.DATABASE_URL ?? '')

interface OrgRow extends OrgRecord {
  name: string
}

interface MemberRow {
  org_id: string
  email: string
  role: 'director' | 'member'
  status: 'pending' | 'active'
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

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

  // Tight: creating organisations is rare and each one is a lasting side
  // effect. Key on both IP and email so neither axis alone can spray.
  const rlKey = `org-onboarding:${clientIp(req.headers['x-forwarded-for'])}:${email.toLowerCase()}`
  const limit = await checkRateLimit(sql, rlKey, 6, 60)
  if (!limit.ok) {
    res.setHeader('Retry-After', String(limit.retryAfter))
    res.status(429).json({ error: 'too many requests' })
    return
  }

  const body = (req.body ?? {}) as { orgName?: unknown; initialMemberEmails?: unknown }
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
      // Oldest membership wins, mirroring org-session.ts so this "are you
      // already in an org?" check resolves to the same row the session does.
      sql`SELECT org_id, email, role, status FROM org_members WHERE lower(email) = lower(${email}) ORDER BY created_at ASC LIMIT 1` as unknown as Promise<
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
          VALUES (${raceOrgId}, ${email.toLowerCase()}, 'member', 'pending')
          ON CONFLICT (org_id, lower(email)) DO NOTHING
        `
        const org = orgs.find((candidate) => candidate.id === raceOrgId)
        res.status(200).json({ outcome: 'joined_existing', org: { id: raceOrgId, name: org?.name ?? '' } })
        return
      }
    }

    const [createdOrg] = (await sql`
      INSERT INTO organizations (name, domain) VALUES (${orgName}, ${domain}) RETURNING id, name
    `) as { id: string; name: string }[]

    // org_members is uniquely indexed on (org_id, lower(email)) and every
    // read compares with lower(email) -- so every write stores the
    // lowercased form, including the director's own row from the token.
    await sql`
      INSERT INTO org_members (org_id, email, role, status) VALUES (${createdOrg.id}, ${email.toLowerCase()}, 'director', 'active')
    `

    // Every org needs at least one shared tab -- the Manage Organisation UI
    // and the prompt-tab picker assume one exists, and shared prompts are
    // always filed under a tab. Without this a brand-new org has none until
    // the first prompt lazily creates one.
    await sql`
      INSERT INTO org_tabs (org_id, name, sort_order) VALUES (${createdOrg.id}, 'General', 0)
    `

    // Invited emails go in as `pending`, not `active`: the person confirms
    // by signing in and the director approves them. Adding them straight to
    // `active` would let anyone who can reach onboarding (any public-domain
    // sign-in can) pre-seed a stranger's address into an org they control
    // and, once that stranger first signs in, read their reported usage and
    // run counts. A pending row exposes none of that (every member read
    // requires status = 'active').
    for (const memberEmail of initialMemberEmails) {
      if (memberEmail === email.toLowerCase()) continue
      await sql`
        INSERT INTO org_members (org_id, email, role, status, invited_by)
        VALUES (${createdOrg.id}, ${memberEmail}, 'member', 'pending', ${email})
        ON CONFLICT (org_id, lower(email)) DO NOTHING
      `
    }

    res.status(200).json({ outcome: 'created', org: { id: createdOrg.id, name: createdOrg.name }, role: 'director' })
  } catch (error) {
    console.error('[org-onboarding] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
