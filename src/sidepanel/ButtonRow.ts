import type { Button } from '../shared/types'

export interface ButtonRowContext {
  isFirst: boolean
  isLast: boolean
  onEdit: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

export function renderButtonRow(button: Button, context: ButtonRowContext): HTMLElement {
  const item = document.createElement('li')
  item.className = 'button-row'

  const name = document.createElement('span')
  name.className = 'button-row-name'
  name.textContent = button.name
  item.appendChild(name)

  const controls = document.createElement('div')
  controls.className = 'button-row-controls'

  const upButton = document.createElement('button')
  upButton.type = 'button'
  upButton.className = 'icon-button'
  upButton.textContent = '↑'
  upButton.setAttribute('aria-label', `Move ${button.name} up`)
  upButton.disabled = context.isFirst
  upButton.addEventListener('click', context.onMoveUp)
  controls.appendChild(upButton)

  const downButton = document.createElement('button')
  downButton.type = 'button'
  downButton.className = 'icon-button'
  downButton.textContent = '↓'
  downButton.setAttribute('aria-label', `Move ${button.name} down`)
  downButton.disabled = context.isLast
  downButton.addEventListener('click', context.onMoveDown)
  controls.appendChild(downButton)

  const editButton = document.createElement('button')
  editButton.type = 'button'
  editButton.className = 'icon-button'
  editButton.textContent = 'Edit'
  editButton.setAttribute('aria-label', `Edit ${button.name}`)
  editButton.addEventListener('click', context.onEdit)
  controls.appendChild(editButton)

  const deleteButton = document.createElement('button')
  deleteButton.type = 'button'
  deleteButton.className = 'icon-button icon-button-danger'
  deleteButton.textContent = 'Delete'
  deleteButton.setAttribute('aria-label', `Delete ${button.name}`)
  deleteButton.addEventListener('click', context.onDelete)
  controls.appendChild(deleteButton)

  item.appendChild(controls)
  return item
}
