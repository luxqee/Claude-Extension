import type { UsageSnapshot } from '../shared/usage'

export function severityClass(severity: string): 'normal' | 'warning' | 'critical' {
  if (severity === 'normal') return 'normal'
  if (severity === 'warning') return 'warning'
  return 'critical'
}

export function renderUsageCard(usage: UsageSnapshot): HTMLElement {
  const card = document.createElement('div')
  card.className = 'usage-card'

  usage.meters.forEach((meter) => {
    const row = document.createElement('div')
    row.className = 'usage-card-row'

    const label = document.createElement('span')
    label.className = 'usage-card-label'
    label.textContent = meter.label
    row.appendChild(label)

    const clamped = Math.min(100, Math.max(0, meter.percent))
    const track = document.createElement('div')
    track.className = 'usage-card-track'
    const fill = document.createElement('div')
    fill.className = `usage-card-fill usage-card-fill-${severityClass(meter.severity)}`
    fill.style.width = `${clamped}%`
    track.appendChild(fill)
    row.appendChild(track)

    const pct = document.createElement('span')
    pct.className = 'usage-card-pct'
    pct.textContent = `${Math.round(clamped)}%`
    row.appendChild(pct)

    card.appendChild(row)
  })

  return card
}
