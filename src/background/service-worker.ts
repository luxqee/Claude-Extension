chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
    console.error('[Claude Tools] failed to set side panel behavior', error)
  })
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading') return
  const isClaudeTab = tab.url?.startsWith('https://claude.ai/') ?? false
  chrome.sidePanel
    .setOptions({
      tabId,
      path: 'src/sidepanel/index.html',
      enabled: isClaudeTab,
    })
    .catch((error) => {
      console.error('[Claude Tools] failed to update side panel options for tab', tabId, error)
    })
})
