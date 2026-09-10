import { API_BASE_URL } from './org-prompts'

export interface OrgSummary {
  id: string
  name: string
}

export type OrgSessionState =
  | { state: 'active'; org: OrgSummary; role: 'director' | 'member' }
  | { state: 'pending'; org: OrgSummary }
  | { state: 'needs_onboarding' }

export interface OnboardingResult {
  outcome: 'created' | 'joined_existing'
  org: OrgSummary
  role?: 'director'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseOrgSummary(value: unknown): OrgSummary | null {
  if (!isRecord(value)) return null
  const id = value.id
  const name = value.name
  if (typeof id !== 'string' || typeof name !== 'string') return null
  return { id, name }
}

export function parseOrgSessionResponse(raw: unknown): OrgSessionState | null {
  if (!isRecord(raw)) return null
  const state = raw.state

  if (state === 'needs_onboarding') return { state: 'needs_onboarding' }

  if (state === 'pending') {
    const org = parseOrgSummary(raw.org)
    return org ? { state: 'pending', org } : null
  }

  if (state === 'active') {
    const org = parseOrgSummary(raw.org)
    const role = raw.role
    if (!org || (role !== 'director' && role !== 'member')) return null
    return { state: 'active', org, role }
  }

  return null
}

export function parseOnboardingResponse(raw: unknown): OnboardingResult | null {
  if (!isRecord(raw)) return null
  const outcome = raw.outcome
  const org = parseOrgSummary(raw.org)
  if (!org) return null

  if (outcome === 'joined_existing') return { outcome: 'joined_existing', org }

  if (outcome === 'created') {
    const role = raw.role
    if (role !== 'director') return null
    return { outcome: 'created', org, role }
  }

  return null
}

export async function fetchOrgSession(idToken: string): Promise<OrgSessionState | null> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/org-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    })
  } catch (error) {
    console.error('[Claude Tools] failed to fetch org session', error)
    return null
  }
  if (!response.ok) {
    console.error('[Claude Tools] org-session endpoint returned status', response.status)
    return null
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    console.error('[Claude Tools] org-session response was not valid JSON', error)
    return null
  }
  return parseOrgSessionResponse(body)
}

export type LeaveOrgResult = 'left' | 'last_admin' | 'not_in_org' | 'error'

/** Withdraws the caller from their current organisation (member or pending
 * invitee). The last active admin gets `'last_admin'` and stays put. */
export async function leaveOrg(idToken: string): Promise<LeaveOrgResult> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/org-session`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    })
  } catch (error) {
    console.error('[Claude Tools] failed to leave organisation', error)
    return 'error'
  }
  if (response.status === 204) return 'left'
  if (response.status === 400) return 'last_admin'
  if (response.status === 404) return 'not_in_org'
  console.error('[Claude Tools] org leave returned status', response.status)
  return 'error'
}

export async function submitOrgOnboarding(
  idToken: string,
  orgName: string,
  initialMemberEmails: string[],
): Promise<OnboardingResult | null> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/org-onboarding`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgName, initialMemberEmails }),
    })
  } catch (error) {
    console.error('[Claude Tools] failed to submit org onboarding', error)
    return null
  }
  if (!response.ok) {
    console.error('[Claude Tools] org-onboarding endpoint returned status', response.status)
    return null
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    console.error('[Claude Tools] org-onboarding response was not valid JSON', error)
    return null
  }
  return parseOnboardingResponse(body)
}
