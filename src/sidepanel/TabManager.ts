import type { ToolTab } from '../shared/types'

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
  back.textContent = '← Back'
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

    const emoji = document.createElement('input')
    emoji.type = 'text'
    emoji.className = 'tab-manager-emoji'
    emoji.value = tab.emoji ?? ''
    emoji.maxLength = 2
    emoji.setAttribute('aria-label', `Emoji for ${tab.name}`)
    emoji.placeholder = '–'

    const name = document.createElement('input')
    name.type = 'text'
    name.className = 'tab-manager-name'
    name.value = tab.name
    name.setAttribute('aria-label', `Name for ${tab.name}`)

    function commit(): void {
      const nextName = name.value.trim()
      const nextEmoji = emoji.value.trim() || null
      if (nextName.length === 0) {
        name.value = tab.name
        return
      }
      if (nextName === tab.name && nextEmoji === (tab.emoji ?? null)) return
      context.onRename(tab.id, nextName, nextEmoji)
    }
    name.addEventListener('blur', commit)
    emoji.addEventListener('blur', commit)
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        ;(e.target as HTMLInputElement).blur()
      }
    })

    row.appendChild(emoji)
    row.appendChild(name)

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
    up.textContent = '↑'
    up.setAttribute('aria-label', `Move ${tab.name} up`)
    up.disabled = index === 0
    up.addEventListener('click', () => context.onReorder(tab.id, 'up'))
    controls.appendChild(up)

    const down = document.createElement('button')
    down.type = 'button'
    down.className = 'icon-button'
    down.textContent = '↓'
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
  add.textContent = '+ New tab'
  add.addEventListener('click', context.onAdd)
  panel.appendChild(add)

  return panel
}
