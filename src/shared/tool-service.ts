import type { Button, ButtonType } from './types'
import type { StorageAdapter } from './storage/storage-adapter'

export class ToolService {
  constructor(private readonly storage: StorageAdapter) {}

  async listButtons(): Promise<Button[]> {
    const buttons = await this.storage.getButtons()
    return [...buttons].sort((a, b) => a.order - b.order)
  }

  async createButton(name: string, prompt: string, type: ButtonType = 'prompt'): Promise<Button> {
    const existing = await this.storage.getButtons()
    const nextOrder = existing.length === 0 ? 0 : Math.max(...existing.map((b) => b.order)) + 1
    const button: Button = {
      id: crypto.randomUUID(),
      name,
      order: nextOrder,
      prompt,
      type,
    }
    await this.storage.saveButton(button)
    return button
  }

  async updateButton(
    id: string,
    updates: { name?: string; prompt?: string; type?: ButtonType },
  ): Promise<void> {
    const buttons = await this.storage.getButtons()
    const button = buttons.find((b) => b.id === id)
    if (!button) throw new Error(`Button not found: ${id}`)
    await this.storage.saveButton({
      ...button,
      name: updates.name ?? button.name,
      prompt: updates.prompt ?? button.prompt,
      type: updates.type ?? button.type,
    })
  }

  async deleteButton(id: string): Promise<void> {
    await this.storage.deleteButton(id)
  }

  async reorderButtons(orderedIds: string[]): Promise<void> {
    await this.storage.reorderButtons(orderedIds)
  }
}
