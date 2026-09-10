import { DEFAULT_TAB_NAME, type Button, type ButtonType, type ToolTab } from './types'
import type { StorageAdapter } from './storage/storage-adapter'

function nextOrder(items: { order: number }[]): number {
  return items.length === 0 ? 0 : Math.max(...items.map((i) => i.order)) + 1
}

export class ToolService {
  constructor(private readonly storage: StorageAdapter) {}

  // --- tabs ---

  async listTabs(): Promise<ToolTab[]> {
    const tabs = await this.storage.getTabs()
    return [...tabs].sort((a, b) => a.order - b.order)
  }

  /**
   * The tab new buttons land in when none is specified: the first tab by
   * order. The storage layer's migration guarantees at least one tab
   * exists, but if somehow none does, one named `${DEFAULT_TAB_NAME}` is
   * created here.
   */
  async getDefaultTab(): Promise<ToolTab> {
    const tabs = await this.listTabs()
    if (tabs[0]) return tabs[0]
    return this.createTab(DEFAULT_TAB_NAME)
  }

  async createTab(name: string, emoji: string | null = null): Promise<ToolTab> {
    const tabs = await this.listTabs()
    const tab: ToolTab = {
      id: crypto.randomUUID(),
      name,
      emoji,
      order: nextOrder(tabs),
    }
    await this.storage.saveTab(tab)
    return tab
  }

  /** Finds a tab by exact (case-insensitive) name, creating it if absent.
   * Used by backup import, which references tabs by name. */
  async ensureTabByName(name: string, emoji: string | null = null): Promise<ToolTab> {
    const tabs = await this.listTabs()
    const existing = tabs.find((t) => t.name.toLowerCase() === name.toLowerCase())
    if (existing) return existing
    return this.createTab(name, emoji)
  }

  async updateTab(id: string, updates: { name?: string; emoji?: string | null }): Promise<void> {
    const tabs = await this.storage.getTabs()
    const tab = tabs.find((t) => t.id === id)
    if (!tab) throw new Error(`Tab not found: ${id}`)
    await this.storage.saveTab({
      ...tab,
      name: updates.name ?? tab.name,
      emoji: updates.emoji === undefined ? tab.emoji : updates.emoji,
    })
  }

  /**
   * Deletes a tab. `reassignButtonsTo` is another tab's id to move this
   * tab's buttons into, or null to delete them with the tab. Deleting the
   * last remaining tab is refused by the storage layer.
   */
  async deleteTab(id: string, reassignButtonsTo: string | null): Promise<void> {
    await this.storage.deleteTab(id, reassignButtonsTo)
  }

  async reorderTabs(orderedIds: string[]): Promise<void> {
    await this.storage.reorderTabs(orderedIds)
  }

  // --- buttons ---

  /** All buttons (grouped by tab order, then button order within each
   * tab) when `tabId` is omitted, or just that tab's buttons. */
  async listButtons(tabId?: string): Promise<Button[]> {
    const [tabs, buttons] = await Promise.all([this.listTabs(), this.storage.getButtons()])
    if (tabId !== undefined) {
      return buttons.filter((b) => b.tabId === tabId).sort((a, b) => a.order - b.order)
    }
    const tabRank = new Map(tabs.map((t, index) => [t.id, index]))
    return [...buttons].sort((a, b) => {
      const rankA = tabRank.get(a.tabId) ?? Number.MAX_SAFE_INTEGER
      const rankB = tabRank.get(b.tabId) ?? Number.MAX_SAFE_INTEGER
      return rankA !== rankB ? rankA - rankB : a.order - b.order
    })
  }

  async createButton(
    name: string,
    prompt: string,
    type: ButtonType = 'prompt',
    tabId?: string,
  ): Promise<Button> {
    const targetTabId = tabId ?? (await this.getDefaultTab()).id
    const existing = await this.storage.getButtons()
    const inTab = existing.filter((b) => b.tabId === targetTabId)
    const button: Button = {
      id: crypto.randomUUID(),
      tabId: targetTabId,
      name,
      order: nextOrder(inTab),
      prompt,
      type,
    }
    await this.storage.saveButton(button)
    return button
  }

  async updateButton(
    id: string,
    updates: { name?: string; prompt?: string; type?: ButtonType; tabId?: string },
  ): Promise<void> {
    const buttons = await this.storage.getButtons()
    const button = buttons.find((b) => b.id === id)
    if (!button) throw new Error(`Button not found: ${id}`)

    const movingToTab = updates.tabId !== undefined && updates.tabId !== button.tabId
    const order = movingToTab
      ? nextOrder(buttons.filter((b) => b.tabId === updates.tabId))
      : button.order

    await this.storage.saveButton({
      ...button,
      name: updates.name ?? button.name,
      prompt: updates.prompt ?? button.prompt,
      type: updates.type ?? button.type,
      tabId: updates.tabId ?? button.tabId,
      order,
    })
  }

  /** Moves a button to the end of another tab. */
  async moveButtonToTab(id: string, tabId: string): Promise<void> {
    await this.updateButton(id, { tabId })
  }

  async deleteButton(id: string): Promise<void> {
    await this.storage.deleteButton(id)
  }

  async reorderButtons(orderedIds: string[]): Promise<void> {
    await this.storage.reorderButtons(orderedIds)
  }
}
