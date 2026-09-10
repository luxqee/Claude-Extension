import { describe, expect, it } from 'vitest'
import { parseOrgAnalytics } from '../../src/shared/org-analytics'

describe('parseOrgAnalytics', () => {
  it('returns empty arrays for non-object input', () => {
    expect(parseOrgAnalytics(null)).toEqual({ topPrompts: [], perMember: [], dailyRuns: [] })
  })

  it('parses a full payload', () => {
    const raw = {
      topPrompts: [{ promptId: 'p1', name: 'Summarize', runCount: 12 }],
      perMember: [{ email: 'a@b.com', runCount: 7, lastUsedAt: '2026-09-01T00:00:00Z' }],
      dailyRuns: [
        { day: '2026-09-09', runCount: 3 },
        { day: '2026-09-10', runCount: 5 },
      ],
    }
    expect(parseOrgAnalytics(raw)).toEqual(raw)
  })

  it('defaults a missing runCount to 0 and a missing lastUsedAt to null', () => {
    const raw = {
      topPrompts: [{ promptId: 'p1', name: 'X' }],
      perMember: [{ email: 'a@b.com' }],
      dailyRuns: [{ day: '2026-09-10' }],
    }
    expect(parseOrgAnalytics(raw)).toEqual({
      topPrompts: [{ promptId: 'p1', name: 'X', runCount: 0 }],
      perMember: [{ email: 'a@b.com', runCount: 0, lastUsedAt: null }],
      dailyRuns: [{ day: '2026-09-10', runCount: 0 }],
    })
  })

  it('skips entries missing their key identifier', () => {
    const raw = {
      topPrompts: [{ name: 'no id' }, { promptId: 'p1', name: 'ok', runCount: 1 }],
      perMember: [{ runCount: 3 }],
      dailyRuns: [{ runCount: 3 }],
    }
    const parsed = parseOrgAnalytics(raw)
    expect(parsed.topPrompts).toEqual([{ promptId: 'p1', name: 'ok', runCount: 1 }])
    expect(parsed.perMember).toEqual([])
    expect(parsed.dailyRuns).toEqual([])
  })
})
