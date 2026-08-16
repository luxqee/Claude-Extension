const SIDE_PANEL_PATH = 'src/sidepanel/index.html'

function updateSidePanelForTab(tab: chrome.tabs.Tab): void {
  if (tab.id === undefined) return
  const isClaudeTab = tab.url?.startsWith('https://claude.ai/') ?? false
  chrome.sidePanel
    .setOptions({
      tabId: tab.id,
      path: SIDE_PANEL_PATH,
      enabled: isClaudeTab,
    })
    .catch((error) => {
      console.error('[Claude Tools] failed to update side panel options for tab', tab.id, error)
    })
}

function syncAllTabs(): void {
  chrome.tabs
    .query({})
    .then((tabs) => {
      tabs.forEach(updateSidePanelForTab)
    })
    .catch((error) => {
      console.error('[Claude Tools] failed to enumerate tabs for side panel sync', error)
    })
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
    console.error('[Claude Tools] failed to set side panel behavior', error)
  })
  syncAllTabs()
})

chrome.runtime.onStartup.addListener(() => {
  syncAllTabs()
})

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading') return
  updateSidePanelForTab(tab)
})
