import type { OrgMember } from '../shared/org-members'
import type { OrgPrompt } from '../shared/org-prompts'

export interface ManageOrgState {
  members: OrgMember[]
  addError: string | null
  prompts: OrgPrompt[]
  editingPromptId: string | null
  promptFormError: string | null
}

export interface ManageOrganisationContext {
  onApprove: (email: string) => void
  onRemove: (email: string) => void
  onPromote: (email: string) => void
  onDemote: (email: string) => void
  onAdd: (email: string) => void
  onCreatePrompt: (data: { name: string; promptText: string; type: 'prompt' | 'skill' }) => void
  onUpdatePrompt: (id: string, data: { name: string; promptText: string; type: 'prompt' | 'skill' }) => void
  onDeletePrompt: (id: string) => void
  onEditPromptClick: (prompt: OrgPrompt) => void
  onCancelEditPrompt: () => void
  onBack: () => void
}

export function renderManageOrganisation(state: ManageOrgState, context: ManageOrganisationContext): HTMLElement {
  const container = document.createElement('div')
  container.className = 'manage-org'

  const heading = document.createElement('h2')
  heading.className = 'settings-heading'
  heading.textContent = 'Manage Organisation'
  container.appendChild(heading)

  const rosterHeading = document.createElement('h3')
  rosterHeading.className = 'team-section-heading'
  rosterHeading.textContent = 'Members'
  container.appendChild(rosterHeading)

  const list = document.createElement('ul')
  list.className = 'roster-list'
  state.members.forEach((member) => {
    const item = document.createElement('li')
    item.className = 'roster-row'

    const email = document.createElement('span')
    email.className = 'roster-row-email'
    email.textContent = member.email
    item.appendChild(email)

    const status = document.createElement('span')
    status.className = 'roster-row-status'
    status.textContent =
      member.status === 'pending' ? 'Pending' : member.role === 'director' ? 'Director' : 'Member'
    item.appendChild(status)

    const actions = document.createElement('div')
    actions.className = 'roster-row-actions'

    if (member.status === 'pending') {
      const approveButton = document.createElement('button')
      approveButton.type = 'button'
      approveButton.className = 'settings-action-button'
      approveButton.textContent = 'Approve'
      approveButton.addEventListener('click', () => context.onApprove(member.email))
      actions.appendChild(approveButton)
    } else if (member.role === 'member') {
      const promoteButton = document.createElement('button')
      promoteButton.type = 'button'
      promoteButton.className = 'settings-action-button'
      promoteButton.textContent = 'Make director'
      promoteButton.addEventListener('click', () => context.onPromote(member.email))
      actions.appendChild(promoteButton)
    } else {
      const demoteButton = document.createElement('button')
      demoteButton.type = 'button'
      demoteButton.className = 'settings-action-button'
      demoteButton.textContent = 'Remove director role'
      demoteButton.addEventListener('click', () => context.onDemote(member.email))
      actions.appendChild(demoteButton)
    }

    const removeButton = document.createElement('button')
    removeButton.type = 'button'
    removeButton.className = 'icon-button icon-button-danger'
    removeButton.textContent = 'Remove'
    removeButton.addEventListener('click', () => context.onRemove(member.email))
    actions.appendChild(removeButton)

    item.appendChild(actions)
    list.appendChild(item)
  })
  container.appendChild(list)

  const addSection = document.createElement('div')
  addSection.className = 'settings-section'
  const addForm = document.createElement('form')
  addForm.className = 'roster-add-form'
  const addInput = document.createElement('input')
  addInput.type = 'email'
  addInput.required = true
  addInput.placeholder = 'teammate@company.com'
  addForm.appendChild(addInput)
  const addButton = document.createElement('button')
  addButton.type = 'submit'
  addButton.className = 'settings-action-button'
  addButton.textContent = 'Add member'
  addForm.appendChild(addButton)
  addForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const emailValue = addInput.value.trim()
    if (!emailValue) return
    context.onAdd(emailValue)
    addInput.value = ''
  })
  addSection.appendChild(addForm)
  if (state.addError) {
    const error = document.createElement('p')
    error.className = 'settings-error'
    error.textContent = state.addError
    addSection.appendChild(error)
  }
  container.appendChild(addSection)

  const promptsHeading = document.createElement('h3')
  promptsHeading.className = 'team-section-heading'
  promptsHeading.textContent = 'Organisation prompts'
  container.appendChild(promptsHeading)

  const promptsList = document.createElement('ul')
  promptsList.className = 'roster-list'
  state.prompts.forEach((prompt) => {
    const item = document.createElement('li')
    item.className = 'roster-row'

    const name = document.createElement('span')
    name.className = 'roster-row-email'
    name.textContent = prompt.name
    item.appendChild(name)

    const type = document.createElement('span')
    type.className = 'roster-row-status'
    type.textContent = prompt.type === 'skill' ? 'Skill' : 'Prompt'
    item.appendChild(type)

    const actions = document.createElement('div')
    actions.className = 'roster-row-actions'

    const editButton = document.createElement('button')
    editButton.type = 'button'
    editButton.className = 'settings-action-button'
    editButton.textContent = 'Edit'
    editButton.addEventListener('click', () => context.onEditPromptClick(prompt))
    actions.appendChild(editButton)

    const deleteButton = document.createElement('button')
    deleteButton.type = 'button'
    deleteButton.className = 'icon-button icon-button-danger'
    deleteButton.textContent = 'Delete'
    deleteButton.addEventListener('click', () => context.onDeletePrompt(prompt.id))
    actions.appendChild(deleteButton)

    item.appendChild(actions)
    promptsList.appendChild(item)
  })
  container.appendChild(promptsList)

  const editingPrompt = state.prompts.find((p) => p.id === state.editingPromptId) ?? null

  const promptForm = document.createElement('form')
  promptForm.className = 'edit-form'

  const promptTypeToggle = document.createElement('div')
  promptTypeToggle.className = 'type-toggle'
  const promptTypeOption = document.createElement('label')
  promptTypeOption.className = 'type-toggle-option'
  const promptTypeRadio = document.createElement('input')
  promptTypeRadio.type = 'radio'
  promptTypeRadio.name = 'org-prompt-type'
  promptTypeRadio.value = 'prompt'
  promptTypeRadio.checked = (editingPrompt?.type ?? 'prompt') === 'prompt'
  promptTypeOption.appendChild(promptTypeRadio)
  promptTypeOption.appendChild(document.createTextNode('Prompt'))
  promptTypeToggle.appendChild(promptTypeOption)
  const skillTypeOption = document.createElement('label')
  skillTypeOption.className = 'type-toggle-option'
  const skillTypeRadio = document.createElement('input')
  skillTypeRadio.type = 'radio'
  skillTypeRadio.name = 'org-prompt-type'
  skillTypeRadio.value = 'skill'
  skillTypeRadio.checked = editingPrompt?.type === 'skill'
  skillTypeOption.appendChild(skillTypeRadio)
  skillTypeOption.appendChild(document.createTextNode('Skill'))
  promptTypeToggle.appendChild(skillTypeOption)
  promptForm.appendChild(promptTypeToggle)

  const promptNameLabel = document.createElement('label')
  promptNameLabel.textContent = 'Name'
  const promptNameInput = document.createElement('input')
  promptNameInput.type = 'text'
  promptNameInput.required = true
  promptNameInput.value = editingPrompt?.name ?? ''
  promptNameLabel.appendChild(promptNameInput)
  promptForm.appendChild(promptNameLabel)

  const promptTextLabel = document.createElement('label')
  promptTextLabel.textContent = 'Prompt text'
  const promptTextInput = document.createElement('textarea')
  promptTextInput.required = true
  promptTextInput.rows = 6
  promptTextInput.value = editingPrompt?.promptText ?? ''
  promptTextLabel.appendChild(promptTextInput)
  promptForm.appendChild(promptTextLabel)

  const promptActions = document.createElement('div')
  promptActions.className = 'edit-form-actions'
  if (state.editingPromptId) {
    const cancelEditButton = document.createElement('button')
    cancelEditButton.type = 'button'
    cancelEditButton.textContent = 'Cancel'
    cancelEditButton.addEventListener('click', context.onCancelEditPrompt)
    promptActions.appendChild(cancelEditButton)
  }
  const promptSubmitButton = document.createElement('button')
  promptSubmitButton.type = 'submit'
  promptSubmitButton.textContent = state.editingPromptId ? 'Save prompt' : 'Add prompt'
  promptActions.appendChild(promptSubmitButton)
  promptForm.appendChild(promptActions)

  promptForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const name = promptNameInput.value.trim()
    const promptText = promptTextInput.value.trim()
    if (!name || !promptText) return
    const type: 'prompt' | 'skill' = skillTypeRadio.checked ? 'skill' : 'prompt'
    if (state.editingPromptId) {
      context.onUpdatePrompt(state.editingPromptId, { name, promptText, type })
    } else {
      context.onCreatePrompt({ name, promptText, type })
    }
  })

  container.appendChild(promptForm)

  if (state.promptFormError) {
    const promptError = document.createElement('p')
    promptError.className = 'settings-error'
    promptError.textContent = state.promptFormError
    container.appendChild(promptError)
  }

  const backButton = document.createElement('button')
  backButton.type = 'button'
  backButton.className = 'settings-back-button'
  backButton.textContent = '← Back'
  backButton.addEventListener('click', context.onBack)
  container.appendChild(backButton)

  return container
}
