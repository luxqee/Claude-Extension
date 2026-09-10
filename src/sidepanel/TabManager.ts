import type { ToolTab } from '../shared/types'
import { joinTabLabel, splitTabLabel } from '../shared/tab-label'

export interface TabManagerContext {
  defaultTabId: string | null
  buttonCountByTab: Record<string, number>
  onRename: (id: string, name: string, emoji: string | null) => void
  onReorder: (id: string, direction: 'up' | 'down') => void
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

  const list = document.createElement('ul')
  list.className = 'tab-manager-list'

  tabs.forEach((tab, index) => {
    const row = document.createElement('li')
    row.className = 'tab-manager-row'

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

    const up = document.createElement('button')
    up.type = 'button'
    up.className = 'icon-button'
    up.innerHTML = '<span class="gi">↑</span>'
    up.setAttribute('aria-label', `Move ${tab.name} up`)
    up.disabled = index === 0
    up.addEventListener('click', () => context.onReorder(tab.id, 'up'))
    controls.appendChild(up)

    const down = document.createElement('button')
    down.type = 'button'
    down.className = 'icon-button'
    down.innerHTML = '<span class="gi">↓</span>'
    down.setAttribute('aria-label', `Move ${tab.name} down`)
    down.disabled = index === tabs.length - 1
    down.addEventListener('click', () => context.onReorder(tab.id, 'down'))
    controls.appendChild(down)

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
