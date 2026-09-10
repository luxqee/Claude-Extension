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

// The member-mutation endpoints are one route now (org-members-add /
// -approve / -remove / -set-role were folded into POST /api/org-members
// with an `action` field, to stay under Vercel's 12-function Hobby cap).
async function postMemberAction(
  idToken: string,
  payload: { action: 'add' | 'approve' | 'remove' | 'set-role'; email: string; role?: 'director' | 'member' },
): Promise<Response | null> {
  try {
    return await fetch(`${API_BASE_URL}/api/org-members`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    console.error('[Claude Tools] org-members request failed', error)
    return null
  }
}

export async function approveOrgMember(idToken: string, email: string): Promise<boolean> {
  const response = await postMemberAction(idToken, { action: 'approve', email })
  return response?.ok ?? false
}

export async function removeOrgMember(
  idToken: string,
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await postMemberAction(idToken, { action: 'remove', email })
  if (!response) return { ok: false, error: 'Something went wrong. Check the console for details.' }
  return response.ok ? { ok: true } : { ok: false, error: await parseErrorMessage(response) }
}

export async function addOrgMember(idToken: string, email: string): Promise<boolean> {
  const response = await postMemberAction(idToken, { action: 'add', email })
  return response?.ok ?? false
}

export async function setOrgMemberRole(
  idToken: string,
  email: string,
  role: 'director' | 'member',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await postMemberAction(idToken, { action: 'set-role', email, role })
  if (!response) return { ok: false, error: 'Something went wrong. Check the console for details.' }
  return response.ok ? { ok: true } : { ok: false, error: await parseErrorMessage(response) }
}
