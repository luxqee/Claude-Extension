import type { Button } from '../shared/types'

export interface ButtonRowContext {
  isRunning: boolean
  runError: string | null
  onRun: () => void
  onEdit: () => void
  onDelete: () => void
  onDrop: (draggedId: string, position: 'before' | 'after') => void
  onArrowMove: (direction: 'up' | 'down') => void
}

function dropPosition(event: DragEvent, item: HTMLElement): 'before' | 'after' {
  const rect = item.getBoundingClientRect()
  return event.clientY - rect.top > rect.height / 2 ? 'after' : 'before'
}

export function renderButtonRow(button: Button, context: ButtonRowContext): HTMLElement {
  const item = document.createElement('li')
  item.className = 'button-row-wrapper'

  const row = document.createElement('div')
  row.className = 'button-row'

  const dragHandle = document.createElement('button')
  dragHandle.type = 'button'
  dragHandle.className = 'drag-handle'
  dragHandle.textContent = '⠿'
  dragHandle.dataset.buttonId = button.id
  dragHandle.setAttribute('aria-label', `Reorder ${button.name}. Press arrow keys to move, or drag.`)
  dragHandle.draggable = true
  dragHandle.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData('text/plain', button.id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    item.classList.add('dragging')
  })
  dragHandle.addEventListener('dragend', () => {
    item.classList.remove('dragging')
  })
  dragHandle.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      context.onArrowMove('up')
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      context.onArrowMove('down')
    }
  })
  row.appendChild(dragHandle)

  if (button.type === 'skill') {
    const badge = document.createElement('span')
    badge.className = 'skill-badge'
    badge.textContent = '/'
    badge.setAttribute('aria-hidden', 'true')
    row.appendChild(badge)
  }

  const name = document.createElement('button')
  name.type = 'button'
  name.className = 'button-row-name'
  name.textContent = button.name
  name.setAttribute('aria-label', `Run ${button.name}`)
  name.disabled = context.isRunning
  name.addEventListener('click', context.onRun)
  row.appendChild(name)

  const controls = document.createElement('div')
  controls.className = 'button-row-controls'

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

  row.appendChild(controls)
  item.appendChild(row)

  item.addEventListener('dragover', (event) => {
    event.preventDefault()
    const isAfter = dropPosition(event, item) === 'after'
    item.classList.toggle('drag-over-top', !isAfter)
    item.classList.toggle('drag-over-bottom', isAfter)
  })
  item.addEventListener('dragleave', () => {
    item.classList.remove('drag-over-top', 'drag-over-bottom')
  })
  item.addEventListener('drop', (event) => {
    event.preventDefault()
    item.classList.remove('drag-over-top', 'drag-over-bottom')
    const draggedId = event.dataTransfer?.getData('text/plain')
    if (!draggedId || draggedId === button.id) return
    context.onDrop(draggedId, dropPosition(event, item))
  })

  if (context.isRunning) {
    const status = document.createElement('p')
    status.className = 'button-row-status'
    status.textContent = 'Running…'
    item.appendChild(status)
  } else if (context.runError) {
    const status = document.createElement('p')
    status.className = 'button-row-status button-row-status-error'
    status.textContent = context.runError
    item.appendChild(status)
  }

  return item
}
