import type { OrgSessionState } from '../shared/org-session'
import { enabledProviders } from '../shared/auth/providers'
import type { ProviderId } from '../shared/auth/providers'

export interface SettingsPanelContext {
  onExport: () => void
  onImport: (file: File) => void
  onBack: () => void
  importError: string | null
  importSuccessCount: number | null
  session: { email: string } | null
  onSignIn: (providerId: ProviderId) => void
  onSignOut: () => void
  orgSession: OrgSessionState | null
  onOpenManageOrg: () => void
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

    if (context.orgSession?.state === 'active' && context.orgSession.role === 'director') {
      const manageButton = document.createElement('button')
      manageButton.type = 'button'
      manageButton.className = 'settings-action-button'
      manageButton.textContent = 'Manage Organisation'
      manageButton.addEventListener('click', context.onOpenManageOrg)
      authSection.appendChild(manageButton)
    }
  } else {
    const signInLabel = document.createElement('p')
    signInLabel.className = 'settings-hint'
    signInLabel.textContent = 'Sign in to find or set up your organisation.'
    authSection.appendChild(signInLabel)

    for (const provider of enabledProviders()) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'settings-action-button'
      button.textContent = provider.label
      button.addEventListener('click', () => context.onSignIn(provider.id))
      authSection.appendChild(button)
    }
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
  backButton.innerHTML = '<span class="gi">←</span> Back'
  backButton.addEventListener('click', context.onBack)
  container.appendChild(backButton)

  return container
}
