import { describe, expect, it } from 'vitest'
import { parseOrgMembersResponse } from '../../src/shared/org-members'

describe('parseOrgMembersResponse', () => {
  it('parses a list of members', () => {
    const raw = {
      members: [
        { email: 'alice@acme.com', role: 'director', status: 'active', createdAt: '2026-08-19T00:00:00Z' },
        { email: 'bob@acme.com', role: 'member', status: 'pending', createdAt: '2026-08-19T01:00:00Z' },
      ],
    }
    expect(parseOrgMembersResponse(raw)).toEqual([
      { email: 'alice@acme.com', role: 'director', status: 'active', createdAt: '2026-08-19T00:00:00Z' },
      { email: 'bob@acme.com', role: 'member', status: 'pending', createdAt: '2026-08-19T01:00:00Z' },
    ])
  })

  it('skips a malformed entry instead of throwing', () => {
    const raw = { members: [{ email: 'alice@acme.com', role: 'bogus', status: 'active', createdAt: 'x' }] }
    expect(parseOrgMembersResponse(raw)).toEqual([])
  })

  it('returns an empty array when members is missing', () => {
    expect(parseOrgMembersResponse({})).toEqual([])
  })

  it('returns an empty array for non-object input, without throwing', () => {
    expect(parseOrgMembersResponse(null)).toEqual([])
    expect(parseOrgMembersResponse('nope')).toEqual([])
  })
})
