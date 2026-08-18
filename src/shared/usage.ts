export interface UsageMeter {
  label: string
  percent: number
  severity: string
  resetsAt: string | null
}

export interface UsageSnapshot {
  meters: UsageMeter[]
}

const LIMIT_LABELS: Record<string, string> = {
  session: 'Session',
  weekly_all: 'Weekly',
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
  return { label: LIMIT_LABELS[kind] ?? kind, percent, severity, resetsAt }
}

function parseSpendMeter(spend: unknown): UsageMeter | null {
  if (!isRecord(spend) || spend.enabled !== true) return null
  const percent = spend.percent
  const severity = spend.severity
  if (typeof percent !== 'number' || typeof severity !== 'string') return null
  return { label: 'Extra usage', percent, severity, resetsAt: null }
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
