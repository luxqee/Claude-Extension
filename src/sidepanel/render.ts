import type { Button, ButtonType } from '../shared/types'
import type { UsageSnapshot } from '../shared/usage'
import { renderButtonRow } from './ButtonRow'
import { renderCollapsedRail } from './CollapsedRail'
import { renderEditForm } from './EditForm'
import { renderSettingsPanel } from './SettingsPanel'
import { renderUsageCard } from './UsageCard'

export type View = { mode: 'list' } | { mode: 'form'; button: Button | null } | { mode: 'settings' }

export interface RunState {
  isRunning: boolean
  error: string | null
}

export interface SettingsState {
  error: string | null
  successCount: number | null
}

export interface RenderContext {
  onRun: (button: Button) => void
  onEdit: (button: Button) => void
  onDelete: (button: Button) => void
  onDrop: (draggedId: string, targetId: string, position: 'before' | 'after') => void
  onArrowMove: (id: string, direction: 'up' | 'down') => void
  onAddClick: () => void
  onSave: (data: { id: string | null; name: string; prompt: string; type: ButtonType }) => void
  onCancel: () => void
  onOpenSettings: () => void
  onExport: () => void
  onImport: (file: File) => void
  onSettingsBack: () => void
  onToggleCollapse: () => void
  onRefreshUsage: () => void
}

export function withMovedId(
  ids: string[],
  draggedId: string,
  targetId: string,
  position: 'before' | 'after',
): string[] {
  const remaining = ids.filter((id) => id !== draggedId)
  const targetIndex = remaining.indexOf(targetId)
  const insertAt = position === 'before' ? targetIndex : targetIndex + 1
  remaining.splice(insertAt, 0, draggedId)
  return remaining
}

export function withSwappedAdjacent(ids: string[], id: string, direction: 'up' | 'down'): string[] | null {
  const index = ids.indexOf(id)
  const swapWith = direction === 'up' ? index - 1 : index + 1
  if (index === -1 || swapWith < 0 || swapWith >= ids.length) return null
  const next = [...ids]
  ;[next[index], next[swapWith]] = [next[swapWith], next[index]]
  return next
}

function renderEdgeToggle(collapsed: boolean, onToggleCollapse: () => void): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'edge-toggle'
  button.textContent = collapsed ? '›' : '‹'
  button.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar')
  button.addEventListener('click', onToggleCollapse)
  return button
}

export function renderApp(
  root: HTMLElement,
  buttons: Button[],
  view: View,
  runState: Map<string, RunState>,
  settingsState: SettingsState,
  usage: UsageSnapshot | null,
  collapsed: boolean,
  context: RenderContext,
): void {
  root.innerHTML = ''

  if (view.mode === 'form') {
    root.appendChild(renderEditForm(view.button, { onSave: context.onSave, onCancel: context.onCancel }))
    return
  }

  if (view.mode === 'settings') {
    root.appendChild(
      renderSettingsPanel({
        onExport: context.onExport,
        onImport: context.onImport,
        onBack: context.onSettingsBack,
        importError: settingsState.error,
        importSuccessCount: settingsState.successCount,
      }),
    )
    return
  }

  if (collapsed) {
    root.appendChild(renderCollapsedRail(usage, { onRefreshUsage: context.onRefreshUsage }))
    root.appendChild(renderEdgeToggle(true, context.onToggleCollapse))
    return
  }

  root.appendChild(renderEdgeToggle(false, context.onToggleCollapse))

  const header = document.createElement('div')
  header.className = 'toolbar'
  const settingsButton = document.createElement('button')
  settingsButton.type = 'button'
  settingsButton.className = 'icon-button settings-button'
  settingsButton.textContent = '⚙'
  settingsButton.setAttribute('aria-label', 'Settings')
  settingsButton.addEventListener('click', context.onOpenSettings)
  header.appendChild(settingsButton)
  const addButton = document.createElement('button')
  addButton.type = 'button'
  addButton.className = 'add-button'
  addButton.textContent = '+ Add tool'
  addButton.addEventListener('click', context.onAddClick)
  header.appendChild(addButton)
  root.appendChild(header)

  if (usage && usage.meters.length > 0) {
    root.appendChild(renderUsageCard(usage))
  }

  if (buttons.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'empty-state'
    empty.textContent = 'No tools yet. Click "Add tool" to create your first one.'
    root.appendChild(empty)
    return
  }

  const list = document.createElement('ul')
  list.className = 'button-list'
  buttons.forEach((button) => {
    const state = runState.get(button.id) ?? { isRunning: false, error: null }
    list.appendChild(
      renderButtonRow(button, {
        isRunning: state.isRunning,
        runError: state.error,
        onRun: () => context.onRun(button),
        onEdit: () => context.onEdit(button),
        onDelete: () => context.onDelete(button),
        onDrop: (draggedId, position) => context.onDrop(draggedId, button.id, position),
        onArrowMove: (direction) => context.onArrowMove(button.id, direction),
      }),
    )
  })
  root.appendChild(list)
}
