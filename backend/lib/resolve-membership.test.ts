import { describe, expect, it, vi } from 'vitest'
import { resolveActiveMembership, resolveAnyMembership } from './resolve-membership'

type Row = { org_id: string; role: 'director' | 'member'; status?: 'pending' | 'active' }

/** A fake `sql` that mimics ORDER BY (role='director') DESC, (status=
 * 'active') DESC, created_at ASC over a fixed row set -- good enough to
 * prove the two exported functions apply the priority correctly without a
 * real database. */
function fakeSql(rows: Row[], opts: { requireActive?: boolean } = {}) {
  return vi.fn(async () => {
    const pool = opts.requireActive ? rows.filter((r) => r.status === 'active') : rows
    const sorted = [...pool].sort((a, b) => {
      const aDirectorActive = a.role === 'director' && a.status === 'active' ? 1 : 0
      const bDirectorActive = b.role === 'director' && b.status === 'active' ? 1 : 0
      if (aDirectorActive !== bDirectorActive) return bDirectorActive - aDirectorActive
      if (!opts.requireActive) {
        const aActive = a.status === 'active' ? 1 : 0
        const bActive = b.status === 'active' ? 1 : 0
        if (aActive !== bActive) return bActive - aActive
      }
      return 0 // stable: array order already represents created_at ASC
    })
    return sorted.slice(0, 1).map((r) => ({ org_id: r.org_id, role: r.role, status: r.status }))
  }) as unknown as Parameters<typeof resolveActiveMembership>[0]
}

describe('resolveActiveMembership', () => {
  it('returns null with no rows', async () => {
    expect(await resolveActiveMembership(fakeSql([], { requireActive: true }), 'x@y.com')).toBeNull()
  })

  it('picks the only active row', async () => {
    const sql = fakeSql([{ org_id: 'org-a', role: 'member', status: 'active' }], { requireActive: true })
    expect(await resolveActiveMembership(sql, 'x@y.com')).toEqual({ orgId: 'org-a', role: 'member' })
  })

  it('prefers an active director row over an older active member row elsewhere', async () => {
    // Row order = created_at ASC: the member row at org-old is OLDER than
    // the director row at org-new.
    const sql = fakeSql(
      [
        { org_id: 'org-old', role: 'member', status: 'active' },
        { org_id: 'org-new', role: 'director', status: 'active' },
      ],
      { requireActive: true },
    )
    expect(await resolveActiveMembership(sql, 'x@y.com')).toEqual({ orgId: 'org-new', role: 'director' })
  })
})

describe('resolveAnyMembership', () => {
  it('returns null with no rows', async () => {
    expect(await resolveAnyMembership(fakeSql([]), 'x@y.com')).toBeNull()
  })

  it('prefers an active director row over an older pending row elsewhere', async () => {
    const sql = fakeSql([
      { org_id: 'org-old', role: 'member', status: 'pending' },
      { org_id: 'org-new', role: 'director', status: 'active' },
    ])
    expect(await resolveAnyMembership(sql, 'x@y.com')).toEqual({
      orgId: 'org-new',
      role: 'director',
      status: 'active',
    })
  })

  it('falls back to any active row over an older pending row', async () => {
    const sql = fakeSql([
      { org_id: 'org-old', role: 'member', status: 'pending' },
      { org_id: 'org-new', role: 'member', status: 'active' },
    ])
    expect(await resolveAnyMembership(sql, 'x@y.com')).toEqual({
      orgId: 'org-new',
      role: 'member',
      status: 'active',
    })
  })

  it('falls back to the oldest pending row when nothing is active', async () => {
    const sql = fakeSql([
      { org_id: 'org-first', role: 'member', status: 'pending' },
      { org_id: 'org-second', role: 'member', status: 'pending' },
    ])
    expect(await resolveAnyMembership(sql, 'x@y.com')).toEqual({
      orgId: 'org-first',
      role: 'member',
      status: 'pending',
    })
  })
})
