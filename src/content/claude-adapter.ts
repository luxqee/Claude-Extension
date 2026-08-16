import type { InsertAndSendResponse } from '../shared/messages'

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

export function isSendButtonUsable(
  button: Pick<HTMLButtonElement, 'disabled' | 'getAttribute'> | null,
): boolean {
  if (!button) return false
  if (button.disabled) return false
  if (button.getAttribute('aria-disabled') === 'true') return false
  return true
}

export function isInputEmpty(input: Pick<HTMLElement, 'textContent'>): boolean {
  return (input.textContent ?? '').trim().length === 0
}

const CHAT_INPUT_SELECTOR = '[data-testid="chat-input"]'
const SEND_BUTTON_SELECTOR = 'button[aria-label="Send message"]'

const INPUT_POLL_INTERVAL_MS = 150
const INPUT_POLL_TIMEOUT_MS = 3000
const SEND_POLL_INTERVAL_MS = 100
const SEND_POLL_TIMEOUT_MS = 800
const CONFIRM_POLL_INTERVAL_MS = 100
const CONFIRM_POLL_TIMEOUT_MS = 800

function findChatInput(): HTMLElement | null {
  return document.querySelector<HTMLElement>(CHAT_INPUT_SELECTOR)
}

function findUsableSendButton(): HTMLButtonElement | null {
  const button = document.querySelector<HTMLButtonElement>(SEND_BUTTON_SELECTOR)
  return isSendButtonUsable(button) ? button : null
}

function dispatchEnterKey(input: HTMLElement): void {
  const eventInit: KeyboardEventInit = {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
  }
  input.dispatchEvent(new KeyboardEvent('keydown', eventInit))
  input.dispatchEvent(new KeyboardEvent('keyup', eventInit))
}

export async function insertAndSend(prompt: string): Promise<InsertAndSendResponse> {
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
      error: 'send_failed',
      message: "Couldn't type the prompt into Claude's chat box. Try reloading the page.",
    }
  }

  const sendButton = await pollFor(findUsableSendButton, SEND_POLL_INTERVAL_MS, SEND_POLL_TIMEOUT_MS)
  if (sendButton) {
    sendButton.click()
  } else {
    console.warn('[Claude Tools] no usable send button found, falling back to Enter key')
    dispatchEnterKey(input)
  }

  const cleared = await pollFor(
    () => (isInputEmpty(input) ? true : null),
    CONFIRM_POLL_INTERVAL_MS,
    CONFIRM_POLL_TIMEOUT_MS,
  )
  if (!cleared) {
    console.error('[Claude Tools] could not confirm the prompt was sent')
    return {
      ok: false,
      error: 'send_failed',
      message: "Inserted the prompt but couldn't confirm it sent. Check the Claude tab.",
    }
  }

  return { ok: true }
}
