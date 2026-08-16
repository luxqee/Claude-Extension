import type { Button } from '../types'
import type { StorageAdapter } from './storage-adapter'

const STORAGE_KEY = 'buttons'

function isButton(value: unknown): value is Button {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.order === 'number' &&
    typeof candidate.prompt === 'string'
  )
}

export class ChromeLocalStorageAdapter implements StorageAdapter {
  async getButtons(): Promise<Button[]> {
    const result = await chrome.storage.local.get(STORAGE_KEY)
    const stored = result[STORAGE_KEY]
    if (!Array.isArray(stored)) return []
    return stored.filter(isButton)
  }

  async saveButton(button: Button): Promise<void> {
    const buttons = await this.getButtons()
    const index = buttons.findIndex((b) => b.id === button.id)
    if (index === -1) {
      buttons.push(button)
    } else {
      buttons[index] = button
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: buttons })
  }

  async deleteButton(id: string): Promise<void> {
    const buttons = await this.getButtons()
    const filtered = buttons.filter((b) => b.id !== id)
    await chrome.storage.local.set({ [STORAGE_KEY]: filtered })
  }

  async reorderButtons(orderedIds: string[]): Promise<void> {
    const buttons = await this.getButtons()
    const byId = new Map(buttons.map((b) => [b.id, b]))
    const seen = new Set<string>()
    const reordered: Button[] = []
    orderedIds.forEach((id) => {
      const button = byId.get(id)
      if (button) {
        seen.add(id)
        reordered.push(button)
      }
    })
    buttons.forEach((button) => {
      if (!seen.has(button.id)) reordered.push(button)
    })
    const withOrder = reordered.map((button, index) => ({ ...button, order: index }))
    await chrome.storage.local.set({ [STORAGE_KEY]: withOrder })
  }
}
