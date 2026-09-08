export interface UsageMeter {
  label: string
  percent: number
  severity: string
  resetsAt: string | null
  /** Set when this meter exists but claude.ai has turned it off (e.g. out of
   * credits) — a friendly explanation to show instead of a percentage. Null
   * for a normal, active meter. */
  disabledReason: string | null
}

export interface UsageSnapshot {
  meters: UsageMeter[]
}

const LIMIT_LABELS: Record<string, string> = {
  session: 'Session',
  weekly_all: 'Weekly',
}

const DISABLED_REASON_LABELS: Record<string, string> = {
  out_of_credits: 'Out of credits',
}

function friendlyDisabledReason(reason: string): string {
  return DISABLED_REASON_LABELS[reason] ?? reason.replace(/_/g, ' ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseLimitEntry(entry: unknown): UsageMeter | null {
  if (!isRecord(entry)) return null
  const kind = entry.kind
  const percent = entry.percent
  const severity = entry.severity
  if (typeof kind !== 'string' || typeof percent !== 'number' || typeof severity !== 'string') return null
  const resetsAt = typeof entry.resets_at === 'string' ? entry.resets_at : null
  return { label: LIMIT_LABELS[kind] ?? kind, percent, severity, resetsAt, disabledReason: null }
}

function parseSpendMeter(spend: unknown): UsageMeter | null {
  if (!isRecord(spend)) return null
  const percent = spend.percent
  const severity = spend.severity
  if (typeof percent !== 'number' || typeof severity !== 'string') return null

  if (spend.enabled === true) {
    return { label: 'Extra usage', percent, severity, resetsAt: null, disabledReason: null }
  }

  const disabledReason = typeof spend.disabled_reason === 'string' ? spend.disabled_reason : null
  if (!disabledReason) return null
  return { label: 'Extra usage', percent, severity, resetsAt: null, disabledReason: friendlyDisabledReason(disabledReason) }
}

export function formatResetLabel(resetsAt: string | null, nowMs: number): string | null {
  if (resetsAt === null) return null
  const resetMs = Date.parse(resetsAt)
  if (Number.isNaN(resetMs)) return null

  const diffMs = resetMs - nowMs
  if (diffMs < 60_000) return 'resets soon'

  const diffMinutes = Math.floor(diffMs / 60_000)
  if (diffMinutes < 60) return `resets in ${diffMinutes}m`

  const diffHours = Math.floor(diffMs / 3_600_000)
  if (diffHours < 24) return `resets in ${diffHours}h`

  const diffDays = Math.floor(diffMs / 86_400_000)
  return `resets in ${diffDays}d`
}

export function parseUsageResponse(raw: unknown): UsageSnapshot {
  if (!isRecord(raw)) return { meters: [] }

  const meters: UsageMeter[] = []

  if (Array.isArray(raw.limits)) {
    for (const entry of raw.limits) {
      const meter = parseLimitEntry(entry)
      if (meter) meters.push(meter)
    }
  }

  const spendMeter = parseSpendMeter(raw.spend)
  if (spendMeter) meters.push(spendMeter)

  return { meters }
}
