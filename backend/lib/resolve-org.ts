export interface OrgRecord {
  id: string
  domain: string
}

export function resolveOrgId(email: string, orgs: OrgRecord[]): string | null {
  const atIndex = email.lastIndexOf('@')
  if (atIndex === -1 || atIndex === email.length - 1) return null

  const domain = email.slice(atIndex + 1).toLowerCase()
  const match = orgs.find((org) => org.domain.toLowerCase() === domain)
  return match ? match.id : null
}
