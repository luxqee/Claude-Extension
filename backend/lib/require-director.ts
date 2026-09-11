import type { NeonQueryFunction } from '@neondatabase/serverless'
import { resolveActiveMembership } from './resolve-membership.js'

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
  // Delegates to resolve-membership.ts's shared ranking (active director
  // row wins over any other active row) so every other endpoint that reads
  // resolveActiveMembership resolves to the exact same org as this one --
  // see the comment there for why that has to be one function, not one
  // query duplicated per file.
  const membership = await resolveActiveMembership(sql, email)
  return membership && membership.role === 'director' ? { orgId: membership.orgId, email } : null
}
