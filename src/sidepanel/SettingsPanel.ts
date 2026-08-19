export interface SettingsPanelContext {
  onExport: () => void
  onImport: (file: File) => void
  onBack: () => void
  importError: string | null
  importSuccessCount: number | null
  session: { email: string } | null
  onSignIn: () => void
  onSignOut: () => void
}

export function renderSettingsPanel(context: SettingsPanelContext): HTMLElement {
  const container = document.createElement('div')
  container.className = 'settings-panel'

  const heading = document.createElement('h2')
  heading.className = 'settings-heading'
  heading.textContent = 'Settings'
  container.appendChild(heading)

  const authSection = document.createElement('div')
  authSection.className = 'settings-section'
  if (context.session) {
    const signedInAs = document.createElement('p')
    signedInAs.className = 'settings-hint'
    signedInAs.textContent = `Signed in as ${context.session.email}`
    authSection.appendChild(signedInAs)

    const signOutButton = document.createElement('button')
    signOutButton.type = 'button'
    signOutButton.className = 'settings-action-button'
    signOutButton.textContent = 'Sign out'
    signOutButton.addEventListener('click', context.onSignOut)
    authSection.appendChild(signOutButton)
  } else {
    const signInButton = document.createElement('button')
    signInButton.type = 'button'
    signInButton.className = 'settings-action-button'
    signInButton.textContent = 'Sign in with Google'
    signInButton.addEventListener('click', context.onSignIn)
    authSection.appendChild(signInButton)

    const signInHint = document.createElement('p')
    signInHint.className = 'settings-hint'
    signInHint.textContent = "See your company's shared prompts, if your organization has set them up."
    authSection.appendChild(signInHint)
  }
  container.appendChild(authSection)

  const exportSection = document.createElement('div')
  exportSection.className = 'settings-section'
  const exportButton = document.createElement('button')
  exportButton.type = 'button'
  exportButton.className = 'settings-action-button'
  exportButton.textContent = 'Export tools'
  exportButton.addEventListener('click', context.onExport)
  exportSection.appendChild(exportButton)
  const exportHint = document.createElement('p')
  exportHint.className = 'settings-hint'
  exportHint.textContent = 'Downloads all your tools as a .json file.'
  exportSection.appendChild(exportHint)
  container.appendChild(exportSection)

  const importSection = document.createElement('div')
  importSection.className = 'settings-section'
  const importButton = document.createElement('button')
  importButton.type = 'button'
  importButton.className = 'settings-action-button'
  importButton.textContent = 'Import tools'
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = 'application/json'
  fileInput.className = 'settings-file-input'
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (file) context.onImport(file)
    fileInput.value = ''
  })
  importButton.addEventListener('click', () => fileInput.click())
  importSection.appendChild(importButton)
  importSection.appendChild(fileInput)
  const importHint = document.createElement('p')
  importHint.className = 'settings-hint'
  importHint.textContent = 'Adds tools from a .json file to your existing list.'
  importSection.appendChild(importHint)

  if (context.importError) {
    const error = document.createElement('p')
    error.className = 'settings-error'
    error.textContent = context.importError
    importSection.appendChild(error)
  } else if (context.importSuccessCount !== null) {
    const success = document.createElement('p')
    success.className = 'settings-success'
    success.textContent = `Imported ${context.importSuccessCount} tool${context.importSuccessCount === 1 ? '' : 's'}.`
    importSection.appendChild(success)
  }
  container.appendChild(importSection)

  const backButton = document.createElement('button')
  backButton.type = 'button'
  backButton.className = 'settings-back-button'
  backButton.textContent = '← Back'
  backButton.addEventListener('click', context.onBack)
  container.appendChild(backButton)

  return container
}
