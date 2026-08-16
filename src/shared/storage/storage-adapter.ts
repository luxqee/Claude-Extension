import type { Button } from '../types'

export interface StorageAdapter {
  getButtons(): Promise<Button[]>
  saveButton(button: Button): Promise<void>
  deleteButton(id: string): Promise<void>
  reorderButtons(orderedIds: string[]): Promise<void>
}
