const SIDEBAR_COLLAPSED_KEY = 'sidebarCollapsed'

export async function getSidebarCollapsed(): Promise<boolean> {
  const stored = await chrome.storage.local.get(SIDEBAR_COLLAPSED_KEY)
  return stored[SIDEBAR_COLLAPSED_KEY] === true
}

export async function setSidebarCollapsed(collapsed: boolean): Promise<void> {
  await chrome.storage.local.set({ [SIDEBAR_COLLAPSED_KEY]: collapsed })
}
