import type { Button, ToolTab } from '../types'

export interface StorageAdapter {
  // --- tabs ---
  getTabs(): Promise<ToolTab[]>
  saveTab(tab: ToolTab): Promise<void>
  /**
   * Removes a tab. Its buttons are moved to `reassignButtonsTo` when that
   * is another tab's id, or deleted along with the tab when it is null.
   * Implementations must refuse to remove the last remaining tab.
   */
  deleteTab(id: string, reassignButtonsTo: string | null): Promise<void>
  reorderTabs(orderedIds: string[]): Promise<void>

  // --- buttons ---
  getButtons(): Promise<Button[]>
  saveButton(button: Button): Promise<void>
  deleteButton(id: string): Promise<void>
  /**
   * Reorders buttons from a single flat id list. Buttons are grouped by
   * their current tab; within each tab the order follows the sequence in
   * `orderedIds`, and any button absent from the list keeps its place
   * after those that are present.
   */
  reorderButtons(orderedIds: string[]): Promise<void>
}
