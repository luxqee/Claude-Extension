import { describe, expect, it } from 'vitest'
import { parseTabPrefs, resolveActiveTabId } from '../../src/shared/tab-prefs'

describe('parseTabPrefs', () => {
  it('returns nulls for missing / non-object input', () => {
    expect(parseTabPrefs(undefined)).toEqual({ defaultTabId: null, activeTabId: null })
    expect(parseTabPrefs('nope')).toEqual({ defaultTabId: null, activeTabId: null })
  })

  it('keeps only string ids', () => {
    expect(parseTabPrefs({ defaultTabId: 'd', activeTabId: 42 })).toEqual({
      defaultTabId: 'd',
      activeTabId: null,
    })
  })
})

describe('resolveActiveTabId', () => {
  it('returns null when there are no tabs', () => {
    expect(resolveActiveTabId([], { defaultTabId: 'x', activeTabId: 'y' })).toBeNull()
  })

  it('prefers the default tab', () => {
    expect(resolveActiveTabId(['a', 'b', 'c'], { defaultTabId: 'b', activeTabId: 'c' })).toBe('b')
  })

  it('falls back to the last-active tab when no default is set', () => {
    expect(resolveActiveTabId(['a', 'b', 'c'], { defaultTabId: null, activeTabId: 'c' })).toBe('c')
  })

  it('falls back to the first tab when neither pref points at a live tab', () => {
    expect(resolveActiveTabId(['a', 'b'], { defaultTabId: 'gone', activeTabId: 'also-gone' })).toBe('a')
  })
})
