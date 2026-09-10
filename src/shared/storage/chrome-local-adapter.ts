import { DEFAULT_TAB_NAME, type Button, type ButtonType, type ToolTab } from '../types'
import type { StorageAdapter } from './storage-adapter'

const BUTTONS_KEY = 'buttons'
const TABS_KEY = 'tabs'
const SCHEMA_VERSION_KEY = 'schemaVersion'
const CURRENT_SCHEMA_VERSION = 2

type RawButton = {
  id: string
  name: string
  order: number
  prompt: string
  type?: unknown
  tabId?: unknown
}

function isRawButton(value: unknown): value is RawButton {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.order === 'number' &&
    typeof candidate.prompt === 'string'
  )
}

function normalizeType(type: unknown): ButtonType {
  return type === 'skill' ? 'skill' : 'prompt'
}

function isRawTab(value: unknown): value is { id: string; name: string; order: number; emoji?: unknown } {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return typeof c.id === 'string' && typeof c.name === 'string' && typeof c.order === 'number'
}

function normalizeTab(raw: { id: string; name: string; order: number; emoji?: unknown }): ToolTab {
  return {
    id: raw.id,
    name: raw.name,
    order: raw.order,
    emoji: typeof raw.emoji === 'string' && raw.emoji.length > 0 ? raw.emoji : null,
  }
}

export class ChromeLocalStorageAdapter implements StorageAdapter {
  /**
   * Brings stored data up to the current schema. Idempotent and cheap on
   * the common path (a single `get` that finds the version already set).
   *
   * v1 -> v2: buttons were a flat array with no tab. Create one
   * `${DEFAULT_TAB_NAME}` tab and move every existing button into it,
   * keeping each button's existing `order`. A brand-new install (no
   * buttons) still gets the tab, so the rest of the code can assume at
   * least one tab always exists.
   */
  private async migrate(): Promise<void> {
    const stored = await chrome.storage.local.get([SCHEMA_VERSION_KEY, BUTTONS_KEY, TABS_KEY])
    if (stored[SCHEMA_VERSION_KEY] === CURRENT_SCHEMA_VERSION) return

    const existingTabs = Array.isArray(stored[TABS_KEY]) ? (stored[TABS_KEY] as unknown[]) : []
    const existingButtons = Array.isArray(stored[BUTTONS_KEY]) ? (stored[BUTTONS_KEY] as unknown[]) : []

    // If a tab list is already present (e.g. a partially-applied migration
    // from a crash), keep it; otherwise start the General tab.
    const tabs: ToolTab[] =
      existingTabs.length > 0
        ? existingTabs.filter(isRawTab).map(normalizeTab)
        : [{ id: crypto.randomUUID(), name: DEFAULT_TAB_NAME, order: 0, emoji: null }]

    const fallbackTabId = tabs[0].id
    const knownTabIds = new Set(tabs.map((t) => t.id))

    const buttons: Button[] = existingButtons.filter(isRawButton).map((raw) => ({
      id: raw.id,
      name: raw.name,
      order: raw.order,
      prompt: raw.prompt,
      type: normalizeType(raw.type),
      tabId: typeof raw.tabId === 'string' && knownTabIds.has(raw.tabId) ? raw.tabId : fallbackTabId,
    }))

    await chrome.storage.local.set({
      [TABS_KEY]: tabs,
      [BUTTONS_KEY]: buttons,
      [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION,
    })
  }

  // --- tabs ---

  async getTabs(): Promise<ToolTab[]> {
    await this.migrate()
    const result = await chrome.storage.local.get(TABS_KEY)
    const stored = result[TABS_KEY]
    if (!Array.isArray(stored)) return []
    return stored
      .filter(isRawTab)
      .map(normalizeTab)
      .sort((a, b) => a.order - b.order)
  }

  async saveTab(tab: ToolTab): Promise<void> {
    const tabs = await this.getTabs()
    const index = tabs.findIndex((t) => t.id === tab.id)
    if (index === -1) {
      tabs.push(tab)
    } else {
      tabs[index] = tab
    }
    await chrome.storage.local.set({ [TABS_KEY]: tabs })
  }

  async deleteTab(id: string, reassignButtonsTo: string | null): Promise<void> {
    const tabs = await this.getTabs()
    if (tabs.length <= 1) {
      throw new Error('Cannot delete the last tab.')
    }
    if (!tabs.some((t) => t.id === id)) return

    if (reassignButtonsTo !== null && !tabs.some((t) => t.id === reassignButtonsTo)) {
      throw new Error(`Cannot reassign buttons to unknown tab: ${reassignButtonsTo}`)
    }

    const remainingTabs = tabs.filter((t) => t.id !== id).map((t, index) => ({ ...t, order: index }))

    const buttons = await this.getButtons()
    let nextButtons: Button[]
    if (reassignButtonsTo === null) {
      nextButtons = buttons.filter((b) => b.tabId !== id)
    } else {
      const targetTail = buttons.filter((b) => b.tabId === reassignButtonsTo).length
      let appended = 0
      nextButtons = buttons.map((b) =>
        b.tabId === id
          ? { ...b, tabId: reassignButtonsTo, order: targetTail + appended++ }
          : b,
      )
    }

    await chrome.storage.local.set({ [TABS_KEY]: remainingTabs, [BUTTONS_KEY]: nextButtons })
  }

  async reorderTabs(orderedIds: string[]): Promise<void> {
    const tabs = await this.getTabs()
    const byId = new Map(tabs.map((t) => [t.id, t]))
    const seen = new Set<string>()
    const reordered: ToolTab[] = []
    orderedIds.forEach((id) => {
      const tab = byId.get(id)
      if (tab) {
        seen.add(id)
        reordered.push(tab)
      }
    })
    tabs.forEach((tab) => {
      if (!seen.has(tab.id)) reordered.push(tab)
    })
    await chrome.storage.local.set({
      [TABS_KEY]: reordered.map((tab, index) => ({ ...tab, order: index })),
    })
  }

  // --- buttons ---

  async getButtons(): Promise<Button[]> {
    await this.migrate()
    const result = await chrome.storage.local.get([BUTTONS_KEY, TABS_KEY])
    const stored = result[BUTTONS_KEY]
    if (!Array.isArray(stored)) return []
    const tabIds = new Set(
      (Array.isArray(result[TABS_KEY]) ? (result[TABS_KEY] as unknown[]) : [])
        .filter(isRawTab)
        .map((t) => t.id),
    )
    const firstTabId = [...tabIds][0]
    return stored.filter(isRawButton).map((raw) => ({
      id: raw.id,
      name: raw.name,
      order: raw.order,
      prompt: raw.prompt,
      type: normalizeType(raw.type),
      // Self-heal an orphaned button (its tab was removed out from under
      // it somehow) by attaching it to the first tab rather than losing it.
      tabId:
        typeof raw.tabId === 'string' && tabIds.has(raw.tabId)
          ? raw.tabId
          : (firstTabId ?? (typeof raw.tabId === 'string' ? raw.tabId : '')),
    }))
  }

  async saveButton(button: Button): Promise<void> {
    const buttons = await this.getButtons()
    const index = buttons.findIndex((b) => b.id === button.id)
    if (index === -1) {
      buttons.push(button)
    } else {
      buttons[index] = button
    }
    await chrome.storage.local.set({ [BUTTONS_KEY]: buttons })
  }

  async deleteButton(id: string): Promise<void> {
    const buttons = await this.getButtons()
    await chrome.storage.local.set({ [BUTTONS_KEY]: buttons.filter((b) => b.id !== id) })
  }

  async reorderButtons(orderedIds: string[]): Promise<void> {
    const buttons = await this.getButtons()
    const position = new Map(orderedIds.map((id, index) => [id, index]))

    // Reorder within each tab independently: a button named in `orderedIds`
    // sorts by its position there; one that isn't sorts after, keeping its
    // prior relative order.
    const byTab = new Map<string, Button[]>()
    for (const button of buttons) {
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

    await chrome.storage.local.set({ [BUTTONS_KEY]: next })
  }
}
