import { insertAndSend } from './claude-adapter'
import type { InsertAndSendRequest } from '../shared/messages'

console.log('[Claude Tools] content script loaded on', window.location.href)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || (message as InsertAndSendRequest).type !== 'INSERT_AND_SEND') return undefined
  const { prompt } = message as InsertAndSendRequest
  insertAndSend(prompt)
    .then(sendResponse)
    .catch((error) => {
      console.error('[Claude Tools] unexpected error during insertAndSend', error)
      sendResponse({
        ok: false,
        error: 'send_failed',
        message: 'Something went wrong inserting the prompt. Check the console for details.',
      })
    })
  return true
})
