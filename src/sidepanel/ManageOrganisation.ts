import type { OrgMember } from '../shared/org-members'

export interface ManageOrgState {
  members: OrgMember[]
  addError: string | null
}

export interface ManageOrganisationContext {
  onApprove: (email: string) => void
  onRemove: (email: string) => void
  onPromote: (email: string) => void
  onDemote: (email: string) => void
  onAdd: (email: string) => void
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

  const backButton = document.createElement('button')
  backButton.type = 'button'
  backButton.className = 'settings-back-button'
  backButton.textContent = '← Back'
  backButton.addEventListener('click', context.onBack)
  container.appendChild(backButton)

  return container
}
