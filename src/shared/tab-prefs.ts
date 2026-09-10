// Per-viewer UI preferences for the tab bar. Not tool data, so it lives
// outside the StorageAdapter -- a thin wrapper over chrome.storage.local,
// same pattern as the org-prompts cache module.

const TAB_PREFS_KEY = 'tabPrefs'

export interface TabPrefs {
  /** The tab shown when the sidebar is (re)opened. */
  defaultTabId: string | null
  /** The tab last looked at, restored on reopen when no default is set. */
  activeTabId: string | null
}

const EMPTY: TabPrefs = { defaultTabId: null, activeTabId: null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseTabPrefs(raw: unknown): TabPrefs {
  if (!isRecord(raw)) return { ...EMPTY }
  return {
    defaultTabId: typeof raw.defaultTabId === 'string' ? raw.defaultTabId : null,
    activeTabId: typeof raw.activeTabId === 'string' ? raw.activeTabId : null,
  }
}

export async function getTabPrefs(): Promise<TabPrefs> {
  const stored = await chrome.storage.local.get(TAB_PREFS_KEY)
  return parseTabPrefs(stored[TAB_PREFS_KEY])
}

async function patchTabPrefs(patch: Partial<TabPrefs>): Promise<void> {
  const current = await getTabPrefs()
  await chrome.storage.local.set({ [TAB_PREFS_KEY]: { ...current, ...patch } })
}

export async function setActiveTab(id: string | null): Promise<void> {
  await patchTabPrefs({ activeTabId: id })
}

export async function setDefaultTab(id: string | null): Promise<void> {
  await patchTabPrefs({ defaultTabId: id })
}

/**
 * Resolves which tab to show when the sidebar opens, given the current
 * tab list and stored prefs. The user-chosen default tab wins; failing
 * that the last-active tab; failing that the first tab. Always returns a
 * real tab id when any tab exists.
 */
export function resolveActiveTabId(tabIds: string[], prefs: TabPrefs): string | null {
  if (tabIds.length === 0) return null
  if (prefs.defaultTabId && tabIds.includes(prefs.defaultTabId)) return prefs.defaultTabId
  if (prefs.activeTabId && tabIds.includes(prefs.activeTabId)) return prefs.activeTabId
  return tabIds[0]
}
