import { insertPrompt } from './claude-adapter'
import type { InsertPromptRequest } from '../shared/messages'

console.log('[Claude Tools] content script loaded on', window.location.href)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || (message as InsertPromptRequest).type !== 'INSERT_PROMPT') return undefined
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
})
