import type { Button } from '../shared/types'
import { renderButtonRow } from './ButtonRow'
import { renderEditForm } from './EditForm'

export type View = { mode: 'list' } | { mode: 'form'; button: Button | null }

export interface RenderContext {
  onEdit: (button: Button) => void
  onDelete: (button: Button) => void
  onMoveUp: (button: Button) => void
  onMoveDown: (button: Button) => void
  onAddClick: () => void
  onSave: (data: { id: string | null; name: string; prompt: string }) => void
  onCancel: () => void
}

export function renderApp(
  root: HTMLElement,
  buttons: Button[],
  view: View,
  context: RenderContext,
): void {
  root.innerHTML = ''

  if (view.mode === 'form') {
    root.appendChild(renderEditForm(view.button, { onSave: context.onSave, onCancel: context.onCancel }))
    return
  }

  const header = document.createElement('div')
  header.className = 'toolbar'
  const addButton = document.createElement('button')
  addButton.type = 'button'
  addButton.className = 'add-button'
  addButton.textContent = '+ Add tool'
  addButton.addEventListener('click', context.onAddClick)
  header.appendChild(addButton)
  root.appendChild(header)

  if (buttons.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'empty-state'
    empty.textContent = 'No tools yet. Click "Add tool" to create your first one.'
    root.appendChild(empty)
    return
  }

  const list = document.createElement('ul')
  list.className = 'button-list'
  buttons.forEach((button, index) => {
    list.appendChild(
      renderButtonRow(button, {
        isFirst: index === 0,
        isLast: index === buttons.length - 1,
        onEdit: () => context.onEdit(button),
        onDelete: () => context.onDelete(button),
        onMoveUp: () => context.onMoveUp(button),
        onMoveDown: () => context.onMoveDown(button),
      }),
    )
  })
  root.appendChild(list)
}
