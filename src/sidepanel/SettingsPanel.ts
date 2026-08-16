export interface SettingsPanelContext {
  onExport: () => void
  onImport: (file: File) => void
  onBack: () => void
  importError: string | null
  importSuccessCount: number | null
}

export function renderSettingsPanel(context: SettingsPanelContext): HTMLElement {
  const container = document.createElement('div')
  container.className = 'settings-panel'

  const heading = document.createElement('h2')
  heading.className = 'settings-heading'
  heading.textContent = 'Settings'
  container.appendChild(heading)

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
    error.setAttribute('role', 'status')
    error.setAttribute('aria-live', 'polite')
    error.textContent = context.importError
    importSection.appendChild(error)
  } else if (context.importSuccessCount !== null) {
    const success = document.createElement('p')
    success.className = 'settings-success'
    success.setAttribute('role', 'status')
    success.setAttribute('aria-live', 'polite')
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
