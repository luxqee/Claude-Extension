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
