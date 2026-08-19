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
