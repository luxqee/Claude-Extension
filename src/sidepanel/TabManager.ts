import type { ToolTab } from '../shared/types'
import { joinTabLabel, splitTabLabel } from '../shared/tab-label'
import { moveInList } from '../shared/list-order'

export interface TabManagerContext {
  defaultTabId: string | null
  buttonCountByTab: Record<string, number>
  onRename: (id: string, name: string, emoji: string | null) => void
  onReorder: (orderedIds: string[]) => void
  onDelete: (id: string) => void
  onSetDefault: (id: string) => void
  onAdd: () => void
  onBack: () => void
}

export function renderTabManager(tabs: ToolTab[], context: TabManagerContext): HTMLElement {
  const panel = document.createElement('div')
  panel.className = 'tab-manager'

  const back = document.createElement('button')
  back.type = 'button'
  back.className = 'settings-back-button'
  back.innerHTML = '<span class="gi">←</span> Back'
  back.addEventListener('click', context.onBack)
  panel.appendChild(back)

  const heading = document.createElement('h2')
  heading.className = 'settings-heading'
  heading.textContent = 'Tabs'
  panel.appendChild(heading)

  const ids = tabs.map((t) => t.id)
  const list = document.createElement('ul')
  list.className = 'tab-manager-list'

  tabs.forEach((tab) => {
    const row = document.createElement('li')
    row.className = 'tab-manager-row'
    row.dataset.tabId = tab.id

    const handle = document.createElement('button')
    handle.type = 'button'
    handle.className = 'drag-handle'
    handle.textContent = '☰'
    handle.setAttribute('aria-label', `Reorder ${tab.name}. Arrow keys to move, or drag.`)
    handle.draggable = true
    handle.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', tab.id)
      row.classList.add('dragging')
    })
    handle.addEventListener('dragend', () => row.classList.remove('dragging'))
    handle.addEventListener('keydown', (event) => {
      const i = ids.indexOf(tab.id)
      if (event.key === 'ArrowUp' && i > 0) {
        event.preventDefault()
        context.onReorder(moveInList(ids, tab.id, ids[i - 1], 'before'))
      } else if (event.key === 'ArrowDown' && i < ids.length - 1) {
        event.preventDefault()
        context.onReorder(moveInList(ids, tab.id, ids[i + 1], 'after'))
      }
    })
    row.appendChild(handle)

    row.addEventListener('dragover', (event) => {
      event.preventDefault()
      const rect = row.getBoundingClientRect()
      const after = event.clientY - rect.top > rect.height / 2
      row.classList.toggle('drag-over-top', !after)
      row.classList.toggle('drag-over-bottom', after)
    })
    row.addEventListener('dragleave', () => row.classList.remove('drag-over-top', 'drag-over-bottom'))
    row.addEventListener('drop', (event) => {
      event.preventDefault()
      row.classList.remove('drag-over-top', 'drag-over-bottom')
      const draggedId = event.dataTransfer?.getData('text/plain')
      if (!draggedId || draggedId === tab.id) return
      const rect = row.getBoundingClientRect()
      const after = event.clientY - rect.top > rect.height / 2
      context.onReorder(moveInList(ids, draggedId, tab.id, after ? 'after' : 'before'))
    })

    const label = document.createElement('input')
    label.type = 'text'
    label.className = 'tab-manager-name'
    label.value = joinTabLabel(tab.emoji, tab.name)
    label.setAttribute('aria-label', `Name for ${tab.name} (start with an emoji to set an icon)`)

    function commit(): void {
      const { emoji, name } = splitTabLabel(label.value)
      if (name.length === 0) {
        label.value = joinTabLabel(tab.emoji, tab.name)
        return
      }
      if (name === tab.name && emoji === (tab.emoji ?? null)) return
      context.onRename(tab.id, name, emoji)
    }
    label.addEventListener('blur', commit)
    label.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        ;(e.target as HTMLInputElement).blur()
      }
    })
    row.appendChild(label)

    const count = context.buttonCountByTab[tab.id] ?? 0
    const meta = document.createElement('span')
    meta.className = 'tab-manager-count'
    meta.textContent = count === 1 ? '1 tool' : `${count} tools`
    row.appendChild(meta)

    const controls = document.createElement('div')
    controls.className = 'tab-manager-controls'

    const defaultLabel = document.createElement('label')
    defaultLabel.className = 'tab-manager-default'
    const defaultRadio = document.createElement('input')
    defaultRadio.type = 'radio'
    defaultRadio.name = 'default-tab'
    defaultRadio.checked = tab.id === context.defaultTabId
    defaultRadio.addEventListener('change', () => context.onSetDefault(tab.id))
    defaultLabel.appendChild(defaultRadio)
    defaultLabel.appendChild(document.createTextNode('Default'))
    controls.appendChild(defaultLabel)

    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'icon-button icon-button-danger'
    del.textContent = 'Delete'
    del.setAttribute('aria-label', `Delete ${tab.name}`)
    del.disabled = tabs.length <= 1
    del.addEventListener('click', () => context.onDelete(tab.id))
    controls.appendChild(del)

    row.appendChild(controls)
    list.appendChild(row)
  })

  panel.appendChild(list)

  const add = document.createElement('button')
  add.type = 'button'
  add.className = 'settings-action-button'
  add.innerHTML = '<span class="gi">+</span> New tab'
  add.addEventListener('click', context.onAdd)
  panel.appendChild(add)

  return panel
}
