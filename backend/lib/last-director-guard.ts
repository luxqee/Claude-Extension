export interface MemberRoleStatus {
  role: 'director' | 'member'
  status: 'pending' | 'active'
}

export function isLastActiveDirector(target: MemberRoleStatus, otherActiveDirectorCount: number): boolean {
  return target.role === 'director' && target.status === 'active' && otherActiveDirectorCount === 0
}
