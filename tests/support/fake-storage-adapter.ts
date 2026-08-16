import type { Button } from '../../src/shared/types'
import type { StorageAdapter } from '../../src/shared/storage/storage-adapter'

export class FakeStorageAdapter implements StorageAdapter {
  private buttons: Button[] = []

  async getButtons(): Promise<Button[]> {
    return this.buttons.map((b) => ({ ...b }))
  }

  async saveButton(button: Button): Promise<void> {
    const index = this.buttons.findIndex((b) => b.id === button.id)
    if (index === -1) {
      this.buttons.push(button)
    } else {
      this.buttons[index] = button
    }
  }

  async deleteButton(id: string): Promise<void> {
    this.buttons = this.buttons.filter((b) => b.id !== id)
  }

  async reorderButtons(orderedIds: string[]): Promise<void> {
    const byId = new Map(this.buttons.map((b) => [b.id, b]))
    this.buttons = orderedIds
      .map((id, index) => {
        const button = byId.get(id)
        return button ? { ...button, order: index } : undefined
      })
      .filter((b): b is Button => b !== undefined)
  }
}
