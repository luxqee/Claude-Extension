import { describe, expect, it } from 'vitest'
import { badgeFor } from '../../src/shared/badge'

describe('badgeFor', () => {
  it('shows @ for text starting with @, whatever the type', () => {
    expect(badgeFor('prompt', '@Sonnet summarise this')).toBe('@')
    expect(badgeFor('skill', '@mention')).toBe('@')
    expect(badgeFor('prompt', '  @after spaces')).toBe('@')
  })

  it('shows / for a skill, or for text starting with /', () => {
    expect(badgeFor('skill', '/doc-summary')).toBe('/')
    expect(badgeFor('skill', 'no slash here')).toBe('/')
    expect(badgeFor('prompt', '/still-counts')).toBe('/')
  })

  it('shows nothing for a plain prompt', () => {
    expect(badgeFor('prompt', 'just some prompt text')).toBeNull()
    expect(badgeFor('prompt', '')).toBeNull()
  })
})
