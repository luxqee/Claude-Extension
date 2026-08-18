import { describe, expect, it } from 'vitest'
import { resolveOrgId } from './resolve-org'

const ORGS = [
  { id: '11111111-1111-1111-1111-111111111111', domain: 'acme.com' },
  { id: '22222222-2222-2222-2222-222222222222', domain: 'example.org' },
]

describe('resolveOrgId', () => {
  it('returns the matching org id for an email at a known domain', () => {
    expect(resolveOrgId('alice@acme.com', ORGS)).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('matches domains case-insensitively', () => {
    expect(resolveOrgId('alice@ACME.COM', ORGS)).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('returns null for an email at an unknown domain', () => {
    expect(resolveOrgId('alice@unknown.com', ORGS)).toBeNull()
  })

  it('returns null for an email with no @ sign', () => {
    expect(resolveOrgId('not-an-email', ORGS)).toBeNull()
  })

  it('returns null when the orgs list is empty', () => {
    expect(resolveOrgId('alice@acme.com', [])).toBeNull()
  })

  it('matches the second org when the domain corresponds to it', () => {
    expect(resolveOrgId('bob@example.org', ORGS)).toBe('22222222-2222-2222-2222-222222222222')
  })
})
