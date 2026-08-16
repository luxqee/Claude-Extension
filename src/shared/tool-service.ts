import type { Button } from './types'
import type { StorageAdapter } from './storage/storage-adapter'

export class ToolService {
  constructor(private readonly storage: StorageAdapter) {}

  async listButtons(): Promise<Button[]> {
    const buttons = await this.storage.getButtons()
    return [...buttons].sort((a, b) => a.order - b.order)
  }

  async createButton(name: string, prompt: string): Promise<Button> {
    const existing = await this.storage.getButtons()
    const button: Button = {
      id: crypto.randomUUID(),
      name,
      order: existing.length,
      prompt,
    }
    await this.storage.saveButton(button)
    return button
  }

  async updateButton(id: string, updates: { name?: string; prompt?: string }): Promise<void> {
    const buttons = await this.storage.getButtons()
    const button = buttons.find((b) => b.id === id)
    if (!button) throw new Error(`Button not found: ${id}`)
    await this.storage.saveButton({
      ...button,
      name: updates.name ?? button.name,
      prompt: updates.prompt ?? button.prompt,
    })
  }

  async deleteButton(id: string): Promise<void> {
    await this.storage.deleteButton(id)
  }

  async reorderButtons(orderedIds: string[]): Promise<void> {
    await this.storage.reorderButtons(orderedIds)
  }
}
