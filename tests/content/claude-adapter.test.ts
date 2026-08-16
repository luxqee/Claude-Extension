import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isInputEmpty, isSendButtonUsable, pollFor } from '../../src/content/claude-adapter'

describe('pollFor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves immediately when find() returns a value on the first call', async () => {
    const find = vi.fn(() => 'found')
    const result = await pollFor(find, 10, 30)
    expect(result).toBe('found')
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('polls until find() returns a value, then resolves with it', async () => {
    const find = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(null).mockReturnValueOnce('found')

    const promise = pollFor(find, 10, 100)
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(10)
    const result = await promise

    expect(result).toBe('found')
    expect(find).toHaveBeenCalledTimes(3)
  })

  it('resolves null after exhausting the timeout without ever finding a value', async () => {
    const find = vi.fn(() => null)
    const promise = pollFor(find, 10, 30)
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(10)
    const result = await promise

    expect(result).toBeNull()
    expect(find).toHaveBeenCalledTimes(4)
  })
})

describe('isSendButtonUsable', () => {
  it('returns false for null', () => {
    expect(isSendButtonUsable(null)).toBe(false)
  })

  it('returns false when disabled is true', () => {
    expect(isSendButtonUsable({ disabled: true, getAttribute: () => null })).toBe(false)
  })

  it('returns false when aria-disabled is "true"', () => {
    expect(isSendButtonUsable({ disabled: false, getAttribute: () => 'true' })).toBe(false)
  })

  it('returns true when enabled and not aria-disabled', () => {
    expect(isSendButtonUsable({ disabled: false, getAttribute: () => null })).toBe(true)
  })

  it('ignores an unrelated data-trigger-disabled attribute', () => {
    expect(
      isSendButtonUsable({
        disabled: false,
        getAttribute: (name: string) => (name === 'data-trigger-disabled' ? '' : null),
      }),
    ).toBe(true)
  })
})

describe('isInputEmpty', () => {
  it('returns true for empty textContent', () => {
    expect(isInputEmpty({ textContent: '' })).toBe(true)
  })

  it('returns true for whitespace-only textContent', () => {
    expect(isInputEmpty({ textContent: '   \n  ' })).toBe(true)
  })

  it('returns false for non-empty textContent', () => {
    expect(isInputEmpty({ textContent: 'hello' })).toBe(false)
  })

  it('returns true for null textContent', () => {
    expect(isInputEmpty({ textContent: null } as unknown as Pick<HTMLElement, 'textContent'>)).toBe(true)
  })
})
