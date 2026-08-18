import { insertPrompt } from './claude-adapter'
import { fetchUsage } from './usage-client'
import type { InsertPromptRequest } from '../shared/messages'

console.log('[Claude Tools] content script loaded on', window.location.href)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof (message as { type?: unknown }).type !== 'string') return undefined
  const type = (message as { type: string }).type

  if (type === 'INSERT_PROMPT') {
    const { prompt } = message as InsertPromptRequest
    insertPrompt(prompt)
      .then(sendResponse)
      .catch((error) => {
        console.error('[Claude Tools] unexpected error during insertPrompt', error)
        sendResponse({
          ok: false,
          error: 'insert_failed',
          message: 'Something went wrong inserting the prompt. Check the console for details.',
        })
      })
    return true
  }

  if (type === 'GET_USAGE') {
    fetchUsage()
      .then(sendResponse)
      .catch((error) => {
        console.error('[Claude Tools] unexpected error fetching usage', error)
        sendResponse({ ok: false })
      })
    return true
  }

  return undefined
})
