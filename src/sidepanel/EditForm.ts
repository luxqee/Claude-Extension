import type { Button, ButtonType } from '../shared/types'

export interface EditFormContext {
  onSave: (data: { id: string | null; name: string; prompt: string; type: ButtonType }) => void
  onCancel: () => void
}

export function renderEditForm(button: Button | null, context: EditFormContext): HTMLElement {
  const form = document.createElement('form')
  form.className = 'edit-form'

  const initialType: ButtonType = button?.type ?? 'prompt'

  const typeToggle = document.createElement('div')
  typeToggle.className = 'type-toggle'

  const promptOption = document.createElement('label')
  promptOption.className = 'type-toggle-option'
  const promptRadio = document.createElement('input')
  promptRadio.type = 'radio'
  promptRadio.name = 'button-type'
  promptRadio.value = 'prompt'
  promptRadio.checked = initialType === 'prompt'
  promptOption.appendChild(promptRadio)
  promptOption.appendChild(document.createTextNode('Prompt'))
  typeToggle.appendChild(promptOption)

  const skillOption = document.createElement('label')
  skillOption.className = 'type-toggle-option'
  const skillRadio = document.createElement('input')
  skillRadio.type = 'radio'
  skillRadio.name = 'button-type'
  skillRadio.value = 'skill'
  skillRadio.checked = initialType === 'skill'
  skillOption.appendChild(skillRadio)
  skillOption.appendChild(document.createTextNode('Skill'))
  typeToggle.appendChild(skillOption)

  form.appendChild(typeToggle)

  const nameLabel = document.createElement('label')
  nameLabel.textContent = 'Name'
  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.required = true
  nameInput.value = button?.name ?? ''
  nameLabel.appendChild(nameInput)
  form.appendChild(nameLabel)

  const promptLabel = document.createElement('label')
  const promptLabelText = document.createElement('span')
  promptLabelText.textContent = initialType === 'skill' ? 'Skill invocation' : 'Prompt'
  promptLabel.appendChild(promptLabelText)
  const promptInput = document.createElement('textarea')
  promptInput.required = true
  promptInput.rows = 8
  promptInput.value = button?.prompt ?? ''
  promptInput.placeholder = initialType === 'skill' ? '/skill-name argument' : ''
  promptLabel.appendChild(promptInput)
  form.appendChild(promptLabel)

  function updatePromptFieldLabel(type: ButtonType): void {
    promptLabelText.textContent = type === 'skill' ? 'Skill invocation' : 'Prompt'
    promptInput.placeholder = type === 'skill' ? '/skill-name argument' : ''
  }

  promptRadio.addEventListener('change', () => updatePromptFieldLabel('prompt'))
  skillRadio.addEventListener('change', () => updatePromptFieldLabel('skill'))

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
      type: skillRadio.checked ? 'skill' : 'prompt',
    })
  })

  return form
}
