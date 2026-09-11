import type { NeonQueryFunction } from '@neondatabase/serverless'

type Sql = NeonQueryFunction<false, false>

export interface ActiveMembership {
  orgId: string
  role: 'director' | 'member'
}

export interface AnyMembership extends ActiveMembership {
  status: 'pending' | 'active'
}

// The single place every endpoint decides "which organisation does this
// caller's own view/write apply to" when they might have more than one
// org_members row (e.g. a director of their real org who is also a plain
// member of an older org from earlier testing, or someone with a stale
// pending invite elsewhere). Before this existed, half the endpoints
// picked the oldest row of ANY role/status and the other half (director
// actions, via resolveDirectorContext) picked the oldest ACTIVE DIRECTOR
// row specifically -- two people could end up with reads and writes
// silently landing in two different organisations: a director's shared-tab
// writes would go to their real org, but the prompt list they were shown
// came from an older, unrelated membership. Every resolver below ranks an
// active director row first, so a director always sees and manages the
// same org everywhere.

/**
 * For endpoints that only care about active membership (viewing/running
 * shared prompts, reporting usage): the oldest ACTIVE DIRECTOR row if one
 * exists, else the oldest ACTIVE row of any role. Returns null if the
 * caller has no active membership at all.
 */
export async function resolveActiveMembership(sql: Sql, email: string): Promise<ActiveMembership | null> {
  const rows = (await sql`
    SELECT org_id, role FROM org_members
    WHERE lower(email) = lower(${email}) AND status = 'active'
    ORDER BY (role = 'director') DESC, created_at ASC
    LIMIT 1
  `) as { org_id: string; role: 'director' | 'member' }[]
  return rows[0] ? { orgId: rows[0].org_id, role: rows[0].role } : null
}

/**
 * For endpoints that also need to show a pending/no-membership state
 * (org-session, org-onboarding's "are you already in an org" check): same
 * director-first, then any-active, then oldest-pending ranking. Returns
 * null only when the caller has no org_members row at all.
 */
export async function resolveAnyMembership(sql: Sql, email: string): Promise<AnyMembership | null> {
  const rows = (await sql`
    SELECT org_id, role, status FROM org_members
    WHERE lower(email) = lower(${email})
    ORDER BY
      (status = 'active' AND role = 'director') DESC,
      (status = 'active') DESC,
      created_at ASC
    LIMIT 1
  `) as { org_id: string; role: 'director' | 'member'; status: 'pending' | 'active' }[]
  return rows[0] ? { orgId: rows[0].org_id, role: rows[0].role, status: rows[0].status } : null
}
