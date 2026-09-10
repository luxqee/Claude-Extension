import { insertPrompt, watchForSend } from './claude-adapter'
import { initUsageWidget, refreshWidget } from './usage-widget'
import { fetchUsage } from './usage-client'
import type { GetUsageRequest, InsertPromptRequest, PromptSentMessage } from '../shared/messages'

console.log('[Claude Tools] content script loaded on', window.location.href)

void initUsageWidget()

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || (message as InsertPromptRequest).type !== 'INSERT_PROMPT') return undefined
  const { prompt, runToken } = message as InsertPromptRequest
  insertPrompt(prompt)
    .then((response) => {
      sendResponse(response)
      void refreshWidget()
      if (response.ok && runToken) {
        watchForSend(() => {
          const sent: PromptSentMessage = { type: 'PROMPT_SENT', runToken }
          chrome.runtime.sendMessage(sent).catch(() => {
            /* sidebar closed -- nothing to report to */
          })
        })
      }
    })
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || (message as GetUsageRequest).type !== 'GET_USAGE') return undefined
  fetchUsage()
    .then((result) => sendResponse(result))
    .catch((error) => {
      console.error('[Claude Tools] unexpected error during fetchUsage', error)
      sendResponse({ ok: false })
    })
  return true
})
