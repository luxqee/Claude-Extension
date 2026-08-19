export interface OrgOnboardingContext {
  onSubmit: (data: { orgName: string; initialMemberEmails: string[] }) => void
  onCancel: () => void
}

export function renderOrgOnboarding(context: OrgOnboardingContext): HTMLElement {
  const container = document.createElement('div')
  container.className = 'org-onboarding'

  const heading = document.createElement('h2')
  heading.className = 'settings-heading'
  heading.textContent = 'Set up your organisation'
  container.appendChild(heading)

  const hint = document.createElement('p')
  hint.className = 'settings-hint'
  hint.textContent = 'No organisation exists yet for your email. Name yours to become its admin.'
  container.appendChild(hint)

  const form = document.createElement('form')
  form.className = 'edit-form'

  const nameLabel = document.createElement('label')
  nameLabel.textContent = 'Organisation name'
  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.required = true
  nameLabel.appendChild(nameInput)
  form.appendChild(nameLabel)

  const emailsLabel = document.createElement('label')
  const emailsLabelText = document.createElement('span')
  emailsLabelText.textContent = 'Add teammates now (optional)'
  emailsLabel.appendChild(emailsLabelText)
  const emailsInput = document.createElement('textarea')
  emailsInput.rows = 4
  emailsInput.placeholder = 'One email per line'
  emailsLabel.appendChild(emailsInput)
  form.appendChild(emailsLabel)

  const actions = document.createElement('div')
  actions.className = 'edit-form-actions'

  const cancelButton = document.createElement('button')
  cancelButton.type = 'button'
  cancelButton.textContent = 'Cancel'
  cancelButton.addEventListener('click', context.onCancel)
  actions.appendChild(cancelButton)

  const submitButton = document.createElement('button')
  submitButton.type = 'submit'
  submitButton.textContent = 'Create organisation'
  actions.appendChild(submitButton)

  form.appendChild(actions)

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const orgName = nameInput.value.trim()
    if (!orgName) return
    const initialMemberEmails = emailsInput.value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    context.onSubmit({ orgName, initialMemberEmails })
  })

  container.appendChild(form)
  return container
}
