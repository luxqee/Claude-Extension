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
    const buttons = this.buttons.map((b) => ({ ...b }))
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
    this.buttons = reordered.map((button, index) => ({ ...button, order: index }))
  }
}
