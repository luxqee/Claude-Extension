import { describe, expect, it } from 'vitest'
import { parseUsageResponse, formatResetLabel } from '../../src/shared/usage'

const REAL_RESPONSE = {
  five_hour: {
    utilization: 12,
    resets_at: '2026-08-18T14:10:00.150665+00:00',
    limit_dollars: null,
    used_dollars: null,
    remaining_dollars: null,
  },
  seven_day: {
    utilization: 25,
    resets_at: '2026-08-19T23:00:00.150689+00:00',
    limit_dollars: null,
    used_dollars: null,
    remaining_dollars: null,
  },
  seven_day_oauth_apps: null,
  seven_day_opus: null,
  seven_day_sonnet: null,
  tangelo: null,
  nimbus_quill: { utilization: 0, resets_at: null, limit_dollars: null, used_dollars: null, remaining_dollars: null },
  limits: [
    {
      kind: 'session',
      group: 'session',
      percent: 12,
      severity: 'normal',
      resets_at: '2026-08-18T14:10:00.150665+00:00',
      scope: null,
      is_active: false,
    },
    {
      kind: 'weekly_all',
      group: 'weekly',
      percent: 25,
      severity: 'normal',
      resets_at: '2026-08-19T23:00:00.150689+00:00',
      scope: null,
      is_active: true,
    },
  ],
  spend: {
    used: { amount_minor: 2929, currency: 'AUD', exponent: 2 },
    limit: { amount_minor: 4000, currency: 'AUD', exponent: 2 },
    percent: 73,
    severity: 'normal',
    enabled: true,
    disabled_reason: null,
  },
  member_dashboard_available: false,
}

describe('parseUsageResponse', () => {
  it('builds a meter for each entry in limits, with a friendly label', () => {
    const result = parseUsageResponse(REAL_RESPONSE)
    expect(result.meters).toContainEqual({
      label: 'Session',
      percent: 12,
      severity: 'normal',
      resetsAt: '2026-08-18T14:10:00.150665+00:00',
      disabledReason: null,
    })
    expect(result.meters).toContainEqual({
      label: 'Weekly',
      percent: 25,
      severity: 'normal',
      resetsAt: '2026-08-19T23:00:00.150689+00:00',
      disabledReason: null,
    })
  })

  it('includes an "Extra usage" meter when spend is enabled', () => {
    const result = parseUsageResponse(REAL_RESPONSE)
    expect(result.meters).toContainEqual({
      label: 'Extra usage',
      percent: 73,
      severity: 'normal',
      resetsAt: null,
      disabledReason: null,
    })
  })

  it('includes a disabled "Extra usage" meter with a friendly reason when spend is disabled with one', () => {
    // Real captured response: the user had extra usage before, ran out of
    // credits, and claude.ai disabled it server-side rather than removing it.
    const response = {
      ...REAL_RESPONSE,
      spend: {
        used: { amount_minor: 413000, currency: 'AUD', exponent: 2 },
        limit: null,
        percent: 0,
        severity: 'normal',
        enabled: false,
        disabled_reason: 'out_of_credits',
      },
    }
    const result = parseUsageResponse(response)
    expect(result.meters).toContainEqual({
      label: 'Extra usage',
      percent: 0,
      severity: 'normal',
      resetsAt: null,
      disabledReason: 'Out of credits',
    })
  })

  it('falls back to a humanized version of an unrecognized disabled_reason', () => {
    const response = {
      spend: { enabled: false, disabled_reason: 'some_new_reason', percent: 0, severity: 'normal' },
    }
    const result = parseUsageResponse(response)
    expect(result.meters).toContainEqual(
      expect.objectContaining({ label: 'Extra usage', disabledReason: 'some new reason' }),
    )
  })

  it('omits the spend meter when spend.enabled is false and there is no disabled_reason', () => {
    const response = { ...REAL_RESPONSE, spend: { ...REAL_RESPONSE.spend, enabled: false, disabled_reason: null } }
    const result = parseUsageResponse(response)
    expect(result.meters.find((m) => m.label === 'Extra usage')).toBeUndefined()
  })

  it('omits the spend meter when spend is missing entirely', () => {
    const { spend: _spend, ...rest } = REAL_RESPONSE
    const result = parseUsageResponse(rest)
    expect(result.meters.find((m) => m.label === 'Extra usage')).toBeUndefined()
  })

  it('ignores unrecognized fields like internal codenames, producing exactly the 3 known meters', () => {
    const result = parseUsageResponse(REAL_RESPONSE)
    expect(result.meters).toHaveLength(3)
  })

  it('passes severity through as-is, even at a high percentage', () => {
    const response = { ...REAL_RESPONSE, spend: { ...REAL_RESPONSE.spend, percent: 95, severity: 'normal' } }
    const result = parseUsageResponse(response)
    const spendMeter = result.meters.find((m) => m.label === 'Extra usage')
    expect(spendMeter?.severity).toBe('normal')
  })

  it('falls back to the raw kind as the label for an unrecognized limit kind', () => {
    const response = {
      limits: [{ kind: 'mystery_limit', percent: 50, severity: 'normal', resets_at: null }],
    }
    const result = parseUsageResponse(response)
    expect(result.meters).toEqual([
      { label: 'mystery_limit', percent: 50, severity: 'normal', resetsAt: null, disabledReason: null },
    ])
  })

  it('skips a limits entry missing a required field instead of throwing', () => {
    const response = { limits: [{ kind: 'session', percent: 12 }] }
    expect(() => parseUsageResponse(response)).not.toThrow()
    expect(parseUsageResponse(response).meters).toEqual([])
  })

  it('returns no meters for a response with no limits and no spend', () => {
    expect(parseUsageResponse({})).toEqual({ meters: [] })
  })

  it('returns no meters when given non-object input, without throwing', () => {
    expect(parseUsageResponse(null)).toEqual({ meters: [] })
    expect(parseUsageResponse('not an object')).toEqual({ meters: [] })
    expect(parseUsageResponse(undefined)).toEqual({ meters: [] })
  })
})

describe('formatResetLabel', () => {
  const NOW = Date.parse('2026-08-18T12:00:00.000Z')

  it('returns null when there is no reset time', () => {
    expect(formatResetLabel(null, NOW)).toBeNull()
  })

  it('returns null for an unparseable timestamp', () => {
    expect(formatResetLabel('not a date', NOW)).toBeNull()
  })

  it('reports "resets soon" for a time in the past', () => {
    expect(formatResetLabel('2026-08-18T11:00:00.000Z', NOW)).toBe('resets soon')
  })

  it('reports "resets soon" for under a minute away', () => {
    expect(formatResetLabel('2026-08-18T12:00:30.000Z', NOW)).toBe('resets soon')
  })

  it('reports minutes for under an hour away', () => {
    expect(formatResetLabel('2026-08-18T12:05:00.000Z', NOW)).toBe('resets in 5m')
    expect(formatResetLabel('2026-08-18T12:59:00.000Z', NOW)).toBe('resets in 59m')
  })

  it('reports hours for under a day away', () => {
    expect(formatResetLabel('2026-08-18T13:30:00.000Z', NOW)).toBe('resets in 1h')
    expect(formatResetLabel('2026-08-19T11:00:00.000Z', NOW)).toBe('resets in 23h')
  })

  it('reports days for a day or more away', () => {
    expect(formatResetLabel('2026-08-19T13:00:00.000Z', NOW)).toBe('resets in 1d')
    expect(formatResetLabel('2026-08-24T12:00:00.000Z', NOW)).toBe('resets in 6d')
  })
})
