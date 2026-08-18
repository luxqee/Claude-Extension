import { fetchUsage } from './usage-client'
import { pollFor } from './claude-adapter'

const ANCHOR_SELECTOR = '[data-testid="sidebar-recents"]'
const WIDGET_ID = 'claude-tools-usage-widget'
const STYLE_ID = 'claude-tools-usage-widget-style'

const RING_RADIUS = 19
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
const SVG_NS = 'http://www.w3.org/2000/svg'

const WIDGET_CSS = `
#${WIDGET_ID} {
  margin: 10px 8px 8px;
  padding: 10px 10px 8px;
  border-radius: 10px;
  background: #131210;
  border: 1px solid #262420;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, Helvetica, Arial, sans-serif;
}
#${WIDGET_ID} .ctu-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
#${WIDGET_ID} .ctu-title {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #8a877e;
}
#${WIDGET_ID} .ctu-refresh {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: #8a877e;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}
#${WIDGET_ID} .ctu-refresh:hover {
  background: #1f1e1b;
  color: #d8d6cf;
}
#${WIDGET_ID} .ctu-rings {
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
#${WIDGET_ID} .ctu-ring {
  position: relative;
  width: 46px;
  height: 46px;
  text-align: center;
}
#${WIDGET_ID} .ctu-ring svg {
  width: 46px;
  height: 46px;
  transform: rotate(-90deg);
}
#${WIDGET_ID} .ctu-ring circle {
  fill: none;
  stroke-width: 4;
}
#${WIDGET_ID} .ctu-track {
  stroke: #232220;
}
#${WIDGET_ID} .ctu-fill {
  stroke-linecap: round;
}
#${WIDGET_ID} .ctu-fill.normal {
  stroke: #6fbf73;
}
#${WIDGET_ID} .ctu-fill.warning {
  stroke: #e3ab52;
}
#${WIDGET_ID} .ctu-fill.critical {
  stroke: #ff6b60;
}
#${WIDGET_ID} .ctu-pct {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10.5px;
  font-weight: 700;
  color: #eeece5;
  font-variant-numeric: tabular-nums;
}
#${WIDGET_ID} .ctu-label {
  display: block;
  margin-top: 3px;
  font-size: 9px;
  color: #8a877e;
}
`

function severityClass(severity: string): 'normal' | 'warning' | 'critical' {
  if (severity === 'normal') return 'normal'
  if (severity === 'warning') return 'warning'
  return 'critical'
}

function ensureStyleInjected(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = WIDGET_CSS
  document.head.appendChild(style)
}

function renderRing(label: string, percent: number, severity: string): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'ctu-ring'
  wrap.setAttribute('role', 'img')

  const clamped = Math.min(100, Math.max(0, percent))
  const roundedPct = Math.round(clamped)
  wrap.setAttribute('aria-label', `${label}: ${roundedPct}%`)

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 46 46')

  const track = document.createElementNS(SVG_NS, 'circle')
  track.setAttribute('class', 'ctu-track')
  track.setAttribute('cx', '23')
  track.setAttribute('cy', '23')
  track.setAttribute('r', String(RING_RADIUS))
  svg.appendChild(track)

  const offset = RING_CIRCUMFERENCE - (clamped / 100) * RING_CIRCUMFERENCE
  const fill = document.createElementNS(SVG_NS, 'circle')
  fill.setAttribute('class', `ctu-fill ${severityClass(severity)}`)
  fill.setAttribute('cx', '23')
  fill.setAttribute('cy', '23')
  fill.setAttribute('r', String(RING_RADIUS))
  fill.setAttribute('stroke-dasharray', String(RING_CIRCUMFERENCE))
  fill.setAttribute('stroke-dashoffset', String(offset))
  svg.appendChild(fill)

  wrap.appendChild(svg)

  const pct = document.createElement('span')
  pct.className = 'ctu-pct'
  pct.textContent = `${roundedPct}%`
  wrap.appendChild(pct)

  const labelEl = document.createElement('span')
  labelEl.className = 'ctu-label'
  labelEl.textContent = label
  wrap.appendChild(labelEl)

  return wrap
}

function buildWidget(meters: { label: string; percent: number; severity: string }[]): HTMLElement {
  const widget = document.createElement('div')
  widget.id = WIDGET_ID

  const head = document.createElement('div')
  head.className = 'ctu-head'

  const title = document.createElement('span')
  title.className = 'ctu-title'
  title.textContent = 'Usage'
  head.appendChild(title)

  const refreshButton = document.createElement('button')
  refreshButton.type = 'button'
  refreshButton.className = 'ctu-refresh'
  refreshButton.textContent = '↻'
  refreshButton.setAttribute('aria-label', 'Refresh usage')
  refreshButton.addEventListener('click', () => {
    void refreshWidget()
  })
  head.appendChild(refreshButton)

  widget.appendChild(head)

  const rings = document.createElement('div')
  rings.className = 'ctu-rings'
  meters.forEach((meter) => {
    rings.appendChild(renderRing(meter.label, meter.percent, meter.severity))
  })
  widget.appendChild(rings)

  return widget
}

let resilienceObserverStarted = false
let resilienceCheckScheduled = false

function scheduleResilienceCheck(): void {
  if (resilienceCheckScheduled) return
  resilienceCheckScheduled = true
  setTimeout(() => {
    resilienceCheckScheduled = false
    if (document.getElementById(WIDGET_ID)) return
    if (document.querySelector(ANCHOR_SELECTOR)) void refreshWidget()
  }, 1000)
}

function startResilienceObserver(): void {
  if (resilienceObserverStarted) return
  resilienceObserverStarted = true
  const observer = new MutationObserver(scheduleResilienceCheck)
  observer.observe(document.body, { childList: true, subtree: true })
}

export async function refreshWidget(): Promise<void> {
  const anchor = document.querySelector(ANCHOR_SELECTOR)
  if (!anchor) return

  const response = await fetchUsage()
  if (!response.ok || response.usage.meters.length === 0) return

  ensureStyleInjected()

  const widget = buildWidget(response.usage.meters)
  const existing = document.getElementById(WIDGET_ID)
  if (existing) {
    existing.replaceWith(widget)
  } else {
    anchor.insertAdjacentElement('afterend', widget)
  }
}

export async function initUsageWidget(): Promise<void> {
  const anchor = await pollFor(() => document.querySelector(ANCHOR_SELECTOR), 300, 8000)
  if (!anchor) {
    console.warn('[Claude Tools] sidebar recents anchor not found; usage widget not injected')
    return
  }
  startResilienceObserver()
  await refreshWidget()
}
