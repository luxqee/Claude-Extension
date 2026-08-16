console.log('[Claude Tools] content script loaded on', window.location.href)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'INSERT_AND_SEND') return undefined
  console.warn('[Claude Tools] INSERT_AND_SEND is not implemented yet (Stage 1D)')
  sendResponse({ ok: false, error: 'not_implemented' })
  return true
})
