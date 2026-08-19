import { API_BASE_URL } from './org-prompts'

export interface OrgMember {
  email: string
  role: 'director' | 'member'
  status: 'pending' | 'active'
  createdAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseMember(entry: unknown): OrgMember | null {
  if (!isRecord(entry)) return null
  const email = entry.email
  const role = entry.role
  const status = entry.status
  const createdAt = entry.createdAt
  if (typeof email !== 'string' || typeof createdAt !== 'string') return null
  if (role !== 'director' && role !== 'member') return null
  if (status !== 'pending' && status !== 'active') return null
  return { email, role, status, createdAt }
}

export function parseOrgMembersResponse(raw: unknown): OrgMember[] {
  if (!isRecord(raw) || !Array.isArray(raw.members)) return []
  const members: OrgMember[] = []
  for (const entry of raw.members) {
    const member = parseMember(entry)
    if (member) members.push(member)
  }
  return members
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string') return body.error
  } catch {
    // fall through to the generic message below
  }
  return 'Something went wrong. Check the console for details.'
}

export async function fetchOrgMembers(idToken: string): Promise<OrgMember[] | null> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/org-members`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
  } catch (error) {
    console.error('[Claude Tools] failed to fetch org members', error)
    return null
  }
  if (!response.ok) {
    console.error('[Claude Tools] org-members endpoint returned status', response.status)
    return null
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    console.error('[Claude Tools] org-members response was not valid JSON', error)
    return null
  }
  return parseOrgMembersResponse(body)
}

export async function approveOrgMember(idToken: string, email: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/org-members-approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    return response.ok
  } catch (error) {
    console.error('[Claude Tools] failed to approve org member', error)
    return false
  }
}

export async function removeOrgMember(
  idToken: string,
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/org-members-remove`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (response.ok) return { ok: true }
    return { ok: false, error: await parseErrorMessage(response) }
  } catch (error) {
    console.error('[Claude Tools] failed to remove org member', error)
    return { ok: false, error: 'Something went wrong. Check the console for details.' }
  }
}

export async function addOrgMember(idToken: string, email: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/org-members-add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    return response.ok
  } catch (error) {
    console.error('[Claude Tools] failed to add org member', error)
    return false
  }
}

export async function setOrgMemberRole(
  idToken: string,
  email: string,
  role: 'director' | 'member',
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/org-members-set-role`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    })
    if (response.ok) return { ok: true }
    return { ok: false, error: await parseErrorMessage(response) }
  } catch (error) {
    console.error('[Claude Tools] failed to change org member role', error)
    return { ok: false, error: 'Something went wrong. Check the console for details.' }
  }
}
