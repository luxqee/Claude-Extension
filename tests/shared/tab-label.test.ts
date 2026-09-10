import { describe, expect, it } from 'vitest'
import { splitTabLabel, joinTabLabel } from '../../src/shared/tab-label'

describe('splitTabLabel', () => {
  it('splits a leading emoji from the name', () => {
    expect(splitTabLabel('🚀 Launch')).toEqual({ emoji: '🚀', name: 'Launch' })
  })

  it('handles no space between emoji and name', () => {
    expect(splitTabLabel('📣Marketing')).toEqual({ emoji: '📣', name: 'Marketing' })
  })

  it('returns null emoji when there is none', () => {
    expect(splitTabLabel('Marketing & Sales')).toEqual({ emoji: null, name: 'Marketing & Sales' })
  })

  it('trims surrounding whitespace', () => {
    expect(splitTabLabel('  Writing  ')).toEqual({ emoji: null, name: 'Writing' })
  })

  it('keeps only the first emoji as the icon', () => {
    expect(splitTabLabel('🚀🔥 Ship it')).toEqual({ emoji: '🚀🔥', name: 'Ship it' })
  })

  it('round-trips through joinTabLabel', () => {
    for (const value of ['🚀 Launch', 'Just text', '📁 Docs and files']) {
      const { emoji, name } = splitTabLabel(value)
      expect(joinTabLabel(emoji, name)).toBe(value.trim())
    }
  })
})
