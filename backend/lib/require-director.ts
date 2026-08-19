import type { NeonQueryFunction } from '@neondatabase/serverless'

// `ReturnType<typeof neon>` resolves neon()'s defaulted generic params
// (ArrayMode/FullResults) to their `boolean` constraint rather than their
// `false` default, producing `NeonQueryFunction<boolean, boolean>` --
// invariant-incompatible with the `NeonQueryFunction<false, false>` that
// `neon(url)` actually returns in each caller. Naming the concrete type
// directly avoids that mismatch. Type-only change, no behavior difference.
type Sql = NeonQueryFunction<false, false>

export interface DirectorContext {
  orgId: string
  email: string
}

export async function resolveDirectorContext(sql: Sql, email: string): Promise<DirectorContext | null> {
  // Oldest directorship wins, matching org-session.ts's membership
  // resolution. These two must agree: if a director's session resolves to
  // org A but their management writes went to org B, every director action
  // (prompt CRUD, roster changes) would silently target an org other than
  // the one the UI is showing them.
  const rows = (await sql`
    SELECT org_id FROM org_members
    WHERE lower(email) = lower(${email}) AND role = 'director' AND status = 'active'
    ORDER BY created_at ASC LIMIT 1
  `) as { org_id: string }[]
  return rows[0] ? { orgId: rows[0].org_id, email } : null
}
