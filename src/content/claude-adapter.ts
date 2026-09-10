import type { InsertPromptResponse } from '../shared/messages'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function pollFor<T>(
  find: () => T | null,
  intervalMs: number,
  timeoutMs: number,
): Promise<T | null> {
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / intervalMs) + 1)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = find()
    if (result) return result
    if (attempt < maxAttempts - 1) {
      await sleep(intervalMs)
    }
  }
  return null
}

export function isInputEmpty(input: Pick<HTMLElement, 'textContent'>): boolean {
  return (input.textContent ?? '').trim().length === 0
}

const CHAT_INPUT_SELECTOR = '[data-testid="chat-input"]'

const INPUT_POLL_INTERVAL_MS = 150
const INPUT_POLL_TIMEOUT_MS = 3000

function findChatInput(): HTMLElement | null {
  return document.querySelector<HTMLElement>(CHAT_INPUT_SELECTOR)
}

export async function insertPrompt(prompt: string): Promise<InsertPromptResponse> {
  const input = await pollFor(findChatInput, INPUT_POLL_INTERVAL_MS, INPUT_POLL_TIMEOUT_MS)
  if (!input) {
    console.error('[Claude Tools] chat input not found within timeout')
    return {
      ok: false,
      error: 'input_not_found',
      message: "Couldn't find Claude's chat box. Try reloading the page.",
    }
  }

  input.focus()
  const inserted = document.execCommand('insertText', false, prompt)
  if (!inserted || isInputEmpty(input)) {
    console.error('[Claude Tools] prompt insertion did not take effect')
    return {
      ok: false,
      error: 'insert_failed',
      message: "Couldn't type the prompt into Claude's chat box. Try reloading the page.",
    }
  }

  return { ok: true }
}

const SEND_WATCH_TIMEOUT_MS = 5 * 60 * 1000
const SEND_WATCH_MIN_HOLD_MS = 250

/**
 * After a prompt is inserted, calls `onSent` once if the user is observed
 * to actually submit it: the chat input holds non-empty text for a beat
 * and then clears. Times out silently after 5 minutes (prompt edited away
 * or abandoned). Returns a cancel function.
 */
export function watchForSend(onSent: () => void, now: () => number = Date.now): () => void {
  const input = findChatInput()
  if (!input) return () => {}

  let done = false
  let heldNonEmptySince: number | null = isInputEmpty(input) ? null : now()

  const finish = (fire: boolean): void => {
    if (done) return
    done = true
    observer.disconnect()
    clearTimeout(timer)
    if (fire) onSent()
  }

  const check = (): void => {
    if (done) return
    const empty = isInputEmpty(input)
    if (!empty) {
      if (heldNonEmptySince === null) heldNonEmptySince = now()
      return
    }
    // Input is now empty. Count it as a send only if it had held our text
    // for a moment first (filters out transient states right after insert).
    if (heldNonEmptySince !== null && now() - heldNonEmptySince >= SEND_WATCH_MIN_HOLD_MS) {
      finish(true)
    }
  }

  const observer = new MutationObserver(check)
  observer.observe(input, { childList: true, subtree: true, characterData: true })
  const timer = setTimeout(() => finish(false), SEND_WATCH_TIMEOUT_MS)

  return () => finish(false)
}
