export interface OrgRecord {
  id: string
  domain: string
}

const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'gmx.com',
  'zoho.com',
])

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.toLowerCase())
}

export function resolveOrgId(email: string, orgs: OrgRecord[]): string | null {
  const atIndex = email.lastIndexOf('@')
  if (atIndex === -1 || atIndex === email.length - 1) return null

  const domain = email.slice(atIndex + 1).toLowerCase()
  const match = orgs.find((org) => org.domain.toLowerCase() === domain)
  return match ? match.id : null
}
