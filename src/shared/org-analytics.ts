import { API_BASE_URL } from './api-base'

export interface TopPromptStat {
  promptId: string
  name: string
  runCount: number
}

export interface MemberRunStat {
  email: string
  runCount: number
  /** ISO-8601, or null if this member has never run a shared prompt. */
  lastUsedAt: string | null
}

export interface DailyRunStat {
  /** ISO date, YYYY-MM-DD. */
  day: string
  runCount: number
}

export interface OrgAnalytics {
  topPrompts: TopPromptStat[]
  perMember: MemberRunStat[]
  dailyRuns: DailyRunStat[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseOrgAnalytics(raw: unknown): OrgAnalytics {
  const empty: OrgAnalytics = { topPrompts: [], perMember: [], dailyRuns: [] }
  if (!isRecord(raw)) return empty

  const topPrompts: TopPromptStat[] = []
  if (Array.isArray(raw.topPrompts)) {
    for (const entry of raw.topPrompts) {
      if (!isRecord(entry)) continue
      if (typeof entry.promptId !== 'string' || typeof entry.name !== 'string') continue
      topPrompts.push({
        promptId: entry.promptId,
        name: entry.name,
        runCount: typeof entry.runCount === 'number' ? entry.runCount : 0,
      })
    }
  }

  const perMember: MemberRunStat[] = []
  if (Array.isArray(raw.perMember)) {
    for (const entry of raw.perMember) {
      if (!isRecord(entry) || typeof entry.email !== 'string') continue
      perMember.push({
        email: entry.email,
        runCount: typeof entry.runCount === 'number' ? entry.runCount : 0,
        lastUsedAt: typeof entry.lastUsedAt === 'string' ? entry.lastUsedAt : null,
      })
    }
  }

  const dailyRuns: DailyRunStat[] = []
  if (Array.isArray(raw.dailyRuns)) {
    for (const entry of raw.dailyRuns) {
      if (!isRecord(entry) || typeof entry.day !== 'string') continue
      dailyRuns.push({
        day: entry.day,
        runCount: typeof entry.runCount === 'number' ? entry.runCount : 0,
      })
    }
  }

  return { topPrompts, perMember, dailyRuns }
}

/** Fire-and-forget: report that a shared prompt was inserted. Never
 * throws -- a failure here must not disrupt the insert the user asked for. */
export async function reportPromptRun(token: string, promptId: string): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/prompt-run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptId }),
    })
  } catch (error) {
    console.error('[Claude Tools] failed to report prompt run', error)
  }
}

export async function fetchOrgAnalytics(token: string): Promise<OrgAnalytics | null> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/org-analytics`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (error) {
    console.error('[Claude Tools] failed to fetch org analytics', error)
    return null
  }
  if (!response.ok) {
    console.error('[Claude Tools] org-analytics endpoint returned status', response.status)
    return null
  }
  try {
    return parseOrgAnalytics(await response.json())
  } catch (error) {
    console.error('[Claude Tools] org-analytics response was not valid JSON', error)
    return null
  }
}
