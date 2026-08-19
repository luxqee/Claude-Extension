import { describe, expect, it } from 'vitest'
import { usageSnapshotToReportBody } from '../../src/shared/usage-report'

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
