import type { Button } from '../shared/types'

export function renderApp(root: HTMLElement, buttons: Button[]): void {
  root.innerHTML = ''

  if (buttons.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'empty-state'
    empty.textContent = 'No tools yet. Buttons you add will show up here.'
    root.appendChild(empty)
    return
  }

  const list = document.createElement('ul')
  list.className = 'button-list'
  for (const button of buttons) {
    const item = document.createElement('li')
    item.className = 'button-row'
    const name = document.createElement('span')
    name.className = 'button-row-name'
    name.textContent = button.name
    item.appendChild(name)
    list.appendChild(item)
  }
  root.appendChild(list)
}
