import { describe, expect, it } from 'vitest'
import { isLastActiveDirector } from './last-director-guard'

describe('isLastActiveDirector', () => {
  it('returns true for an active director with no other active directors', () => {
    expect(isLastActiveDirector({ role: 'director', status: 'active' }, 0)).toBe(true)
  })

  it('returns false for an active director when another active director exists', () => {
    expect(isLastActiveDirector({ role: 'director', status: 'active' }, 1)).toBe(false)
  })

  it('returns false for a regular member regardless of other-director count', () => {
    expect(isLastActiveDirector({ role: 'member', status: 'active' }, 0)).toBe(false)
  })

  it('returns false for a pending director (not yet active)', () => {
    expect(isLastActiveDirector({ role: 'director', status: 'pending' }, 0)).toBe(false)
  })
})
