import { describe, expect, it } from 'vitest'
import { usageSnapshotToReportBody, parseOrgUsageResponse } from '../../src/shared/usage-report'

describe('usageSnapshotToReportBody', () => {
  it('maps Session, Weekly, and Extra usage meters to their named fields', () => {
    const snapshot = {
      meters: [
        { label: 'Session', percent: 12, severity: 'normal', resetsAt: null },
        { label: 'Weekly', percent: 25, severity: 'normal', resetsAt: null },
        { label: 'Extra usage', percent: 73, severity: 'normal', resetsAt: null },
      ],
    }
    expect(usageSnapshotToReportBody(snapshot)).toEqual({
      sessionPercent: 12,
      weeklyPercent: 25,
      spendPercent: 73,
    })
  })

  it('reports null for a meter that is absent', () => {
    const snapshot = { meters: [{ label: 'Session', percent: 12, severity: 'normal', resetsAt: null }] }
    expect(usageSnapshotToReportBody(snapshot)).toEqual({
      sessionPercent: 12,
      weeklyPercent: null,
      spendPercent: null,
    })
  })

  it('returns all nulls for an empty meters array', () => {
    expect(usageSnapshotToReportBody({ meters: [] })).toEqual({
      sessionPercent: null,
      weeklyPercent: null,
      spendPercent: null,
    })
  })

  it('ignores an unrecognized meter label', () => {
    const snapshot = { meters: [{ label: 'Mystery', percent: 50, severity: 'normal', resetsAt: null }] }
    expect(usageSnapshotToReportBody(snapshot)).toEqual({
      sessionPercent: null,
      weeklyPercent: null,
      spendPercent: null,
    })
  })
})

describe('parseOrgUsageResponse', () => {
  it('parses a list of usage snapshots', () => {
    const raw = {
      snapshots: [
        { email: 'alice@acme.com', sessionPercent: 12, weeklyPercent: 25, spendPercent: null, updatedAt: '2026-08-19T00:00:00Z' },
      ],
    }
    expect(parseOrgUsageResponse(raw)).toEqual([
      { email: 'alice@acme.com', sessionPercent: 12, weeklyPercent: 25, spendPercent: null, updatedAt: '2026-08-19T00:00:00Z' },
    ])
  })

  it('skips an entry missing email', () => {
    const raw = { snapshots: [{ sessionPercent: 12, weeklyPercent: 25, spendPercent: null, updatedAt: 'x' }] }
    expect(parseOrgUsageResponse(raw)).toEqual([])
  })

  it('returns an empty array when snapshots is missing', () => {
    expect(parseOrgUsageResponse({})).toEqual([])
  })

  it('returns an empty array for non-object input, without throwing', () => {
    expect(parseOrgUsageResponse(null)).toEqual([])
    expect(parseOrgUsageResponse('nope')).toEqual([])
  })
})
