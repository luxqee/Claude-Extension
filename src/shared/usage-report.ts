import { API_BASE_URL } from './org-prompts'
import type { UsageSnapshot } from './usage'

export interface UsageReportBody {
  sessionPercent: number | null
  weeklyPercent: number | null
  spendPercent: number | null
}

export function usageSnapshotToReportBody(snapshot: UsageSnapshot): UsageReportBody {
  const session = snapshot.meters.find((m) => m.label === 'Session')
  const weekly = snapshot.meters.find((m) => m.label === 'Weekly')
  const spend = snapshot.meters.find((m) => m.label === 'Extra usage')
  return {
    sessionPercent: session?.percent ?? null,
    weeklyPercent: weekly?.percent ?? null,
    spendPercent: spend?.percent ?? null,
  }
}

export async function reportUsage(idToken: string, snapshot: UsageSnapshot): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/usage-report`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(usageSnapshotToReportBody(snapshot)),
    })
    return response.ok
  } catch (error) {
    console.error('[Claude Tools] failed to report usage', error)
    return false
  }
}

export interface OrgUsageSnapshot {
  email: string
  sessionPercent: number | null
  weeklyPercent: number | null
  spendPercent: number | null
  updatedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPercentOrNull(value: unknown): value is number | null {
  return value === null || typeof value === 'number'
}

function parseSnapshot(entry: unknown): OrgUsageSnapshot | null {
  if (!isRecord(entry)) return null
  const email = entry.email
  const sessionPercent = entry.sessionPercent
  const weeklyPercent = entry.weeklyPercent
  const spendPercent = entry.spendPercent
  const updatedAt = entry.updatedAt
  if (typeof email !== 'string' || typeof updatedAt !== 'string') return null
  if (!isPercentOrNull(sessionPercent) || !isPercentOrNull(weeklyPercent) || !isPercentOrNull(spendPercent)) {
    return null
  }
  return { email, sessionPercent, weeklyPercent, spendPercent, updatedAt }
}

export function parseOrgUsageResponse(raw: unknown): OrgUsageSnapshot[] {
  if (!isRecord(raw) || !Array.isArray(raw.snapshots)) return []
  const snapshots: OrgUsageSnapshot[] = []
  for (const entry of raw.snapshots) {
    const snapshot = parseSnapshot(entry)
    if (snapshot) snapshots.push(snapshot)
  }
  return snapshots
}

export async function fetchOrgUsage(idToken: string): Promise<OrgUsageSnapshot[] | null> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/org-usage`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
  } catch (error) {
    console.error('[Claude Tools] failed to fetch org usage', error)
    return null
  }
  if (!response.ok) {
    console.error('[Claude Tools] org-usage endpoint returned status', response.status)
    return null
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    console.error('[Claude Tools] org-usage response was not valid JSON', error)
    return null
  }
  return parseOrgUsageResponse(body)
}
