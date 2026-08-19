import { resolveOrgId, isPublicEmailDomain, type OrgRecord } from './resolve-org.js'

export interface OrgMemberRecord {
  orgId: string
  email: string
  role: 'director' | 'member'
  status: 'pending' | 'active'
}

export type SessionResolution =
  | { state: 'active'; orgId: string; role: 'director' | 'member' }
  | { state: 'pending'; orgId: string }
  | { state: 'needs_onboarding' }

export function resolveSessionState(
  email: string,
  existingMember: OrgMemberRecord | null,
  orgs: OrgRecord[],
): SessionResolution {
  if (existingMember) {
    return existingMember.status === 'active'
      ? { state: 'active', orgId: existingMember.orgId, role: existingMember.role }
      : { state: 'pending', orgId: existingMember.orgId }
  }

  const atIndex = email.lastIndexOf('@')
  if (atIndex === -1 || atIndex === email.length - 1) return { state: 'needs_onboarding' }

  const domain = email.slice(atIndex + 1).toLowerCase()
  if (isPublicEmailDomain(domain)) return { state: 'needs_onboarding' }

  const orgId = resolveOrgId(email, orgs)
  if (!orgId) return { state: 'needs_onboarding' }

  return { state: 'pending', orgId }
}
