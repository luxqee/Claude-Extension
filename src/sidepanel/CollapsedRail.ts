import type { Button } from '../shared/types'
import type { UsageSnapshot } from '../shared/usage'
import type { RunState } from './render'
import { severityClass } from './UsageCard'

export interface CollapsedRailContext {
  onToggleCollapse: () => void
  onRefreshUsage: () => void
  onRun: (button: Button) => void
}

const RING_RADIUS = 16
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
const SVG_NS = 'http://www.w3.org/2000/svg'

function renderRing(percent: number, severity: string): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'ring'

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 40 40')

  const track = document.createElementNS(SVG_NS, 'circle')
  track.setAttribute('class', 'track')
  track.setAttribute('cx', '20')
  track.setAttribute('cy', '20')
  track.setAttribute('r', String(RING_RADIUS))
  svg.appendChild(track)

  const clamped = Math.min(100, Math.max(0, percent))
  const offset = RING_CIRCUMFERENCE - (clamped / 100) * RING_CIRCUMFERENCE
  const fill = document.createElementNS(SVG_NS, 'circle')
  fill.setAttribute('class', `fill ${severityClass(severity)}`)
  fill.setAttribute('cx', '20')
  fill.setAttribute('cy', '20')
  fill.setAttribute('r', String(RING_RADIUS))
  fill.setAttribute('stroke-dasharray', String(RING_CIRCUMFERENCE))
  fill.setAttribute('stroke-dashoffset', String(offset))
  svg.appendChild(fill)

  wrap.appendChild(svg)

  const pct = document.createElement('span')
  pct.className = 'pct'
  pct.textContent = `${Math.round(clamped)}%`
  wrap.appendChild(pct)

  return wrap
}

export function renderCollapsedRail(
  buttons: Button[],
  usage: UsageSnapshot | null,
  runState: Map<string, RunState>,
  context: CollapsedRailContext,
): HTMLElement {
  const rail = document.createElement('div')
  rail.className = 'rail'

  const refreshButton = document.createElement('button')
  refreshButton.type = 'button'
  refreshButton.className = 'rail-icon-btn'
  refreshButton.textContent = '↻'
  refreshButton.setAttribute('aria-label', 'Refresh usage')
  refreshButton.addEventListener('click', context.onRefreshUsage)
  rail.appendChild(refreshButton)

  if (usage && usage.meters.length > 0) {
    const rings = document.createElement('div')
    rings.className = 'rail-rings'
    usage.meters.forEach((meter) => {
      rings.appendChild(renderRing(meter.percent, meter.severity))
    })
    rail.appendChild(rings)
  }

  const expandButton = document.createElement('button')
  expandButton.type = 'button'
  expandButton.className = 'rail-expand'
  expandButton.textContent = '→'
  expandButton.setAttribute('aria-label', 'Expand sidebar')
  expandButton.addEventListener('click', context.onToggleCollapse)
  rail.appendChild(expandButton)

  if (buttons.length > 0) {
    const divider = document.createElement('div')
    divider.className = 'rail-divider'
    rail.appendChild(divider)

    const buttonList = document.createElement('div')
    buttonList.className = 'rail-buttons'
    buttons.forEach((button) => {
      const icon = document.createElement('button')
      icon.type = 'button'
      icon.className = 'rail-btn-icon'
      icon.textContent = button.name.trim().charAt(0).toUpperCase() || '?'
      icon.title = button.name
      icon.disabled = runState.get(button.id)?.isRunning ?? false
      icon.setAttribute('aria-label', `Run ${button.name}`)
      icon.addEventListener('click', () => context.onRun(button))
      if (button.type === 'skill') {
        const dot = document.createElement('span')
        dot.className = 'rail-skill-dot'
        dot.textContent = '/'
        dot.setAttribute('aria-hidden', 'true')
        icon.appendChild(dot)
      }
      buttonList.appendChild(icon)
    })
    rail.appendChild(buttonList)
  }

  const spacer = document.createElement('div')
  spacer.className = 'rail-spacer'
  rail.appendChild(spacer)

  const avatar = document.createElement('div')
  avatar.className = 'rail-avatar'
  avatar.title = 'Account (coming in a later phase)'
  avatar.setAttribute('aria-hidden', 'true')
  rail.appendChild(avatar)

  return rail
}
