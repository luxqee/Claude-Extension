import { describe, expect, it } from 'vitest'
import { parseButtonUsage, sortButtonsByMostUsed } from '../../src/shared/prompt-usage'
import type { Button } from '../../src/shared/types'

function btn(id: string, order: number): Button {
  return { id, tabId: 't', name: id, order, prompt: 'x', type: 'prompt' }
}

describe('parseButtonUsage', () => {
  it('returns {} for non-object input', () => {
    expect(parseButtonUsage(null)).toEqual({})
    expect(parseButtonUsage('nope')).toEqual({})
  })

  it('keeps well-formed entries, drops zero/negative/garbage', () => {
    const raw = {
      a: { count: 3, lastUsedAt: 1000 },
      b: { count: 0, lastUsedAt: 5 },
      c: { count: -2, lastUsedAt: 5 },
      d: { count: 'x', lastUsedAt: 5 },
      e: 'not an object',
    }
    expect(parseButtonUsage(raw)).toEqual({ a: { count: 3, lastUsedAt: 1000 } })
  })

  it('floors fractional counts and defaults a bad lastUsedAt to 0', () => {
    expect(parseButtonUsage({ a: { count: 2.9, lastUsedAt: -1 } })).toEqual({ a: { count: 2, lastUsedAt: 0 } })
  })
})

describe('sortButtonsByMostUsed', () => {
  it('orders by count desc, then by original order for ties and unused', () => {
    const buttons = [btn('a', 0), btn('b', 1), btn('c', 2), btn('d', 3)]
    const usage = { b: { count: 5, lastUsedAt: 1 }, d: { count: 5, lastUsedAt: 1 }, a: { count: 1, lastUsedAt: 1 } }
    expect(sortButtonsByMostUsed(buttons, usage).map((x) => x.id)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('does not mutate the input array', () => {
    const buttons = [btn('a', 0), btn('b', 1)]
    const copy = [...buttons]
    sortButtonsByMostUsed(buttons, { b: { count: 9, lastUsedAt: 1 } })
    expect(buttons).toEqual(copy)
  })
})
