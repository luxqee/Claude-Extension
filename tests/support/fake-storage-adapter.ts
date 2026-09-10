import type { Button, ToolTab } from '../../src/shared/types'
import type { StorageAdapter } from '../../src/shared/storage/storage-adapter'

export class FakeStorageAdapter implements StorageAdapter {
  private tabs: ToolTab[] = []
  private buttons: Button[] = []

  /** Seed a starting tab so ToolService tests that don't exercise tab
   * creation still have a default tab, mirroring the real migration. */
  constructor(seedTab: ToolTab | null = { id: 'tab-general', name: 'General', emoji: null, order: 0 }) {
    if (seedTab) this.tabs.push(seedTab)
  }

  async getTabs(): Promise<ToolTab[]> {
    return this.tabs.map((t) => ({ ...t }))
  }

  async saveTab(tab: ToolTab): Promise<void> {
    const index = this.tabs.findIndex((t) => t.id === tab.id)
    if (index === -1) this.tabs.push({ ...tab })
    else this.tabs[index] = { ...tab }
  }

  async deleteTab(id: string, reassignButtonsTo: string | null): Promise<void> {
    if (this.tabs.length <= 1) throw new Error('Cannot delete the last tab.')
    if (!this.tabs.some((t) => t.id === id)) return
    if (reassignButtonsTo !== null && !this.tabs.some((t) => t.id === reassignButtonsTo)) {
      throw new Error(`Cannot reassign buttons to unknown tab: ${reassignButtonsTo}`)
    }
    this.tabs = this.tabs.filter((t) => t.id !== id).map((t, index) => ({ ...t, order: index }))
    if (reassignButtonsTo === null) {
      this.buttons = this.buttons.filter((b) => b.tabId !== id)
    } else {
      let tail = this.buttons.filter((b) => b.tabId === reassignButtonsTo).length
      this.buttons = this.buttons.map((b) =>
        b.tabId === id ? { ...b, tabId: reassignButtonsTo, order: tail++ } : b,
      )
    }
  }

  async reorderTabs(orderedIds: string[]): Promise<void> {
    const byId = new Map(this.tabs.map((t) => [t.id, t]))
    const seen = new Set<string>()
    const reordered: ToolTab[] = []
    orderedIds.forEach((id) => {
      const tab = byId.get(id)
      if (tab) {
        seen.add(id)
        reordered.push(tab)
      }
    })
    this.tabs.forEach((tab) => {
      if (!seen.has(tab.id)) reordered.push(tab)
    })
    this.tabs = reordered.map((tab, index) => ({ ...tab, order: index }))
  }

  async getButtons(): Promise<Button[]> {
    return this.buttons.map((b) => ({ ...b }))
  }

  async saveButton(button: Button): Promise<void> {
    const index = this.buttons.findIndex((b) => b.id === button.id)
    if (index === -1) this.buttons.push({ ...button })
    else this.buttons[index] = { ...button }
  }

  async deleteButton(id: string): Promise<void> {
    this.buttons = this.buttons.filter((b) => b.id !== id)
  }

  async reorderButtons(orderedIds: string[]): Promise<void> {
    const position = new Map(orderedIds.map((id, index) => [id, index]))
    const byTab = new Map<string, Button[]>()
    for (const button of this.buttons.map((b) => ({ ...b }))) {
      const group = byTab.get(button.tabId) ?? []
      group.push(button)
      byTab.set(button.tabId, group)
    }
    const next: Button[] = []
    for (const [, group] of byTab) {
      group
        .map((button, priorIndex) => ({ button, priorIndex }))
        .sort((a, b) => {
          const aPos = position.get(a.button.id)
          const bPos = position.get(b.button.id)
          if (aPos !== undefined && bPos !== undefined) return aPos - bPos
          if (aPos !== undefined) return -1
          if (bPos !== undefined) return 1
          return a.priorIndex - b.priorIndex
        })
        .forEach(({ button }, index) => next.push({ ...button, order: index }))
    }
    this.buttons = next
  }
}
