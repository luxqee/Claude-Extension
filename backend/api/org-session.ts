import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'
import { resolveEmail } from '../lib/resolve-email.js'
import { type OrgRecord } from '../lib/resolve-org.js'
import { resolveSessionState, type OrgMemberRecord } from '../lib/resolve-session.js'
import { isLastActiveDirector } from '../lib/last-director-guard.js'
import { resolveAnyMembership } from '../lib/resolve-membership.js'

const sql = neon(process.env.DATABASE_URL ?? '')

interface OrgRow extends OrgRecord {
  name: string
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const email = await resolveEmail(req.headers.authorization)
  if (!email) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  // DELETE = "leave / withdraw from my current organisation". Drops the
  // caller's own membership row -- the one their session resolves to (see
  // resolve-membership.ts). A member or a pending invitee can always leave;
  // the last active director cannot (they must promote someone first),
  // matching the guard on org-members remove/demote.
  if (req.method === 'DELETE') {
    try {
      const membership = await resolveAnyMembership(sql, email)
      if (!membership) {
        res.status(404).json({ error: 'not in an organisation' })
        return
      }

      if (membership.role === 'director' && membership.status === 'active') {
        const others = (await sql`
          SELECT count(*)::int AS count FROM org_members
          WHERE org_id = ${membership.orgId} AND role = 'director' AND status = 'active'
            AND lower(email) != lower(${email})
        `) as { count: number }[]
        if (isLastActiveDirector({ role: 'director', status: 'active' }, others[0]?.count ?? 0)) {
          res.status(400).json({ error: 'you are the last admin -- promote someone else first' })
          return
        }
      }

      await sql.transaction([
        sql`SELECT set_config('app.current_org_id', ${membership.orgId}, true)`,
        sql`DELETE FROM org_members WHERE org_id = ${membership.orgId} AND lower(email) = lower(${email})`,
      ])
      res.status(204).end()
    } catch (error) {
      console.error('[org-session] leave failed', error)
      res.status(500).json({ error: 'internal error' })
    }
    return
  }

  try {
    const [orgs, membership] = await Promise.all([
      sql`SELECT id, name, domain FROM organizations` as unknown as Promise<OrgRow[]>,
      // Any director can add any email at any domain as an active member
      // (by design -- cross-domain membership is supported), so this must
      // rank an active director row first: picking the newest row would let
      // a director of org X hijack the session of someone who already
      // belongs to org Y, and picking the oldest row of any role/status
      // would show a director someone ELSE's older, unrelated membership
      // instead of the org they actually manage.
      resolveAnyMembership(sql, email),
    ])

    const existingMember: OrgMemberRecord | null = membership
      ? { orgId: membership.orgId, email, role: membership.role, status: membership.status }
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
        VALUES (${resolution.orgId}, ${email.toLowerCase()}, 'member', 'pending')
        ON CONFLICT (org_id, lower(email)) DO NOTHING
      `
    }
    const org = orgs.find((candidate) => candidate.id === resolution.orgId)
    res.status(200).json({ state: 'pending', org: { id: resolution.orgId, name: org?.name ?? '' } })
  } catch (error) {
    console.error('[org-session] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
