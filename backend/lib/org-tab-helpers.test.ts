import { describe, expect, it } from 'vitest'
import { nextSortOrder, canDeleteTab, applyTabReorder, pickFallbackTabId } from './org-tab-helpers'

describe('nextSortOrder', () => {
  it('is 0 for an empty tab', () => {
    expect(nextSortOrder([])).toBe(0)
  })
  it('is one past the max, tolerating gaps', () => {
    expect(nextSortOrder([0, 1, 5])).toBe(6)
  })
})

describe('canDeleteTab', () => {
  it('forbids deleting the only tab', () => {
    expect(canDeleteTab(1)).toBe(false)
    expect(canDeleteTab(0)).toBe(false)
  })
  it('allows deleting when others remain', () => {
    expect(canDeleteTab(2)).toBe(true)
  })
})

describe('applyTabReorder', () => {
  it('applies the requested order', () => {
    expect(applyTabReorder(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b'])
  })
  it('keeps omitted ids in their prior order, after the requested ones', () => {
    expect(applyTabReorder(['a', 'b', 'c', 'd'], ['c', 'a'])).toEqual(['c', 'a', 'b', 'd'])
  })
  it('ignores unknown or duplicate ids from the client', () => {
    expect(applyTabReorder(['a', 'b'], ['b', 'x', 'b', 'a'])).toEqual(['b', 'a'])
  })
})

describe('pickFallbackTabId', () => {
  it('returns the first remaining tab by order', () => {
    expect(pickFallbackTabId([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'a')).toBe('b')
  })
  it('returns null when nothing else remains', () => {
    expect(pickFallbackTabId([{ id: 'a' }], 'a')).toBeNull()
  })
})
