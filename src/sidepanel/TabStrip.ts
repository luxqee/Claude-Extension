import type { ToolTab } from '../shared/types'

export interface TabStripContext {
  activeTabId: string | null
  onSelect: (tabId: string) => void
  onAdd: () => void
  onManage: () => void
  onReorder: (orderedIds: string[]) => void
}

function withMoved(ids: string[], draggedId: string, targetId: string): string[] {
  const remaining = ids.filter((id) => id !== draggedId)
  const at = remaining.indexOf(targetId)
  if (at === -1) return ids
  remaining.splice(at, 0, draggedId)
  return remaining
}

export function renderTabStrip(tabs: ToolTab[], context: TabStripContext): HTMLElement {
  const strip = document.createElement('div')
  strip.className = 'tab-strip'

  const list = document.createElement('div')
  list.className = 'tab-strip-list'
  list.setAttribute('role', 'tablist')
  list.setAttribute('aria-label', 'Tool tabs')

  const ids = tabs.map((t) => t.id)

  tabs.forEach((tab) => {
    const isActive = tab.id === context.activeTabId
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'tab-chip'
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-selected', String(isActive))
    button.tabIndex = isActive ? 0 : -1
    button.dataset.tabId = tab.id
    button.textContent = tab.emoji ? `${tab.emoji} ${tab.name}` : tab.name
    if (isActive) button.classList.add('is-active')

    button.addEventListener('click', () => context.onSelect(tab.id))
    button.addEventListener('keydown', (event) => {
      const currentIndex = tabs.findIndex((t) => t.id === tab.id)
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault()
        const next = tabs[(currentIndex + 1) % tabs.length]
        context.onSelect(next.id)
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault()
        const prev = tabs[(currentIndex - 1 + tabs.length) % tabs.length]
        context.onSelect(prev.id)
      }
    })

    button.draggable = true
    button.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', tab.id)
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
      button.classList.add('dragging')
    })
    button.addEventListener('dragend', () => button.classList.remove('dragging'))
    button.addEventListener('dragover', (event) => event.preventDefault())
    button.addEventListener('drop', (event) => {
      event.preventDefault()
      const draggedId = event.dataTransfer?.getData('text/plain')
      if (!draggedId || draggedId === tab.id) return
      context.onReorder(withMoved(ids, draggedId, tab.id))
    })

    list.appendChild(button)
  })

  const addButton = document.createElement('button')
  addButton.type = 'button'
  addButton.className = 'tab-chip tab-chip-add'
  addButton.textContent = '+'
  addButton.setAttribute('aria-label', 'Add tab')
  addButton.addEventListener('click', context.onAdd)
  list.appendChild(addButton)

  strip.appendChild(list)

  const manageButton = document.createElement('button')
  manageButton.type = 'button'
  manageButton.className = 'icon-button tab-strip-manage'
  manageButton.textContent = 'Edit tabs'
  manageButton.addEventListener('click', context.onManage)
  strip.appendChild(manageButton)

  return strip
}
