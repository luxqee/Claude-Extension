import { describe, expect, it } from 'vitest'
import { parseOrgSessionResponse, parseOnboardingResponse } from '../../src/shared/org-session'

describe('parseOrgSessionResponse', () => {
  it('parses an active state with org and role', () => {
    const raw = { state: 'active', org: { id: 'org-1', name: 'Acme' }, role: 'director' }
    expect(parseOrgSessionResponse(raw)).toEqual({
      state: 'active',
      org: { id: 'org-1', name: 'Acme' },
      role: 'director',
    })
  })

  it('parses a pending state with org, no role', () => {
    const raw = { state: 'pending', org: { id: 'org-1', name: 'Acme' } }
    expect(parseOrgSessionResponse(raw)).toEqual({ state: 'pending', org: { id: 'org-1', name: 'Acme' } })
  })

  it('parses a needs_onboarding state', () => {
    expect(parseOrgSessionResponse({ state: 'needs_onboarding' })).toEqual({ state: 'needs_onboarding' })
  })

  it('returns null for an unrecognized state value', () => {
    expect(parseOrgSessionResponse({ state: 'bogus' })).toBeNull()
  })

  it('returns null when active is missing org', () => {
    expect(parseOrgSessionResponse({ state: 'active', role: 'director' })).toBeNull()
  })

  it('returns null when active has an unrecognized role', () => {
    expect(parseOrgSessionResponse({ state: 'active', org: { id: 'x', name: 'Y' }, role: 'bogus' })).toBeNull()
  })

  it('returns null for non-object input, without throwing', () => {
    expect(parseOrgSessionResponse(null)).toBeNull()
    expect(parseOrgSessionResponse(undefined)).toBeNull()
    expect(parseOrgSessionResponse('nope')).toBeNull()
  })
})

describe('parseOnboardingResponse', () => {
  it('parses a created outcome with role', () => {
    const raw = { outcome: 'created', org: { id: 'org-1', name: 'Acme' }, role: 'director' }
    expect(parseOnboardingResponse(raw)).toEqual({
      outcome: 'created',
      org: { id: 'org-1', name: 'Acme' },
      role: 'director',
    })
  })

  it('parses a joined_existing outcome without role', () => {
    const raw = { outcome: 'joined_existing', org: { id: 'org-1', name: 'Acme' } }
    expect(parseOnboardingResponse(raw)).toEqual({ outcome: 'joined_existing', org: { id: 'org-1', name: 'Acme' } })
  })

  it('returns null for an unrecognized outcome', () => {
    expect(parseOnboardingResponse({ outcome: 'bogus', org: { id: 'x', name: 'Y' } })).toBeNull()
  })

  it('returns null for non-object input, without throwing', () => {
    expect(parseOnboardingResponse(null)).toBeNull()
    expect(parseOnboardingResponse('nope')).toBeNull()
  })
})
