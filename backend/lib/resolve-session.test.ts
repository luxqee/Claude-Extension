import { describe, expect, it } from 'vitest'
import { resolveSessionState } from './resolve-session'

const ORGS = [{ id: 'org-1', domain: 'acme.com' }]

describe('resolveSessionState', () => {
  it('returns active with role for an existing active member', () => {
    const member = { orgId: 'org-1', email: 'alice@acme.com', role: 'director' as const, status: 'active' as const }
    expect(resolveSessionState('alice@acme.com', member, ORGS)).toEqual({
      state: 'active',
      orgId: 'org-1',
      role: 'director',
    })
  })

  it('returns pending for an existing pending member, without re-checking domain', () => {
    const member = { orgId: 'org-1', email: 'bob@acme.com', role: 'member' as const, status: 'pending' as const }
    expect(resolveSessionState('bob@acme.com', member, ORGS)).toEqual({ state: 'pending', orgId: 'org-1' })
  })

  it('returns pending for a new email matching an existing non-public org domain', () => {
    expect(resolveSessionState('carol@acme.com', null, ORGS)).toEqual({ state: 'pending', orgId: 'org-1' })
  })

  it('returns needs_onboarding for a new email at an unknown company domain', () => {
    expect(resolveSessionState('dave@unknown.com', null, ORGS)).toEqual({ state: 'needs_onboarding' })
  })

  it('returns needs_onboarding for a new email at a public domain, even if an org happens to share that domain value', () => {
    const orgsWithPublicDomain = [...ORGS, { id: 'org-2', domain: 'gmail.com' }]
    expect(resolveSessionState('erin@gmail.com', null, orgsWithPublicDomain)).toEqual({
      state: 'needs_onboarding',
    })
  })

  it('returns needs_onboarding for an email with no @ sign', () => {
    expect(resolveSessionState('not-an-email', null, ORGS)).toEqual({ state: 'needs_onboarding' })
  })
})
