import type { Button } from '../shared/types'

export interface EditFormContext {
  onSave: (data: { id: string | null; name: string; prompt: string }) => void
  onCancel: () => void
}

export function renderEditForm(button: Button | null, context: EditFormContext): HTMLElement {
  const form = document.createElement('form')
  form.className = 'edit-form'

  const nameLabel = document.createElement('label')
  nameLabel.textContent = 'Name'
  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.required = true
  nameInput.value = button?.name ?? ''
  nameLabel.appendChild(nameInput)
  form.appendChild(nameLabel)

  const promptLabel = document.createElement('label')
  promptLabel.textContent = 'Prompt'
  const promptInput = document.createElement('textarea')
  promptInput.required = true
  promptInput.rows = 8
  promptInput.value = button?.prompt ?? ''
  promptLabel.appendChild(promptInput)
  form.appendChild(promptLabel)

  const actions = document.createElement('div')
  actions.className = 'edit-form-actions'

  const cancelButton = document.createElement('button')
  cancelButton.type = 'button'
  cancelButton.textContent = 'Cancel'
  cancelButton.addEventListener('click', context.onCancel)
  actions.appendChild(cancelButton)

  const saveButton = document.createElement('button')
  saveButton.type = 'submit'
  saveButton.textContent = 'Save'
  actions.appendChild(saveButton)

  form.appendChild(actions)

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    context.onSave({
      id: button?.id ?? null,
      name: nameInput.value.trim(),
      prompt: promptInput.value.trim(),
    })
  })

  return form
}
