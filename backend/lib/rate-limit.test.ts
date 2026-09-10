import { describe, expect, it, vi } from 'vitest'
import { checkRateLimit, clientIp, secondsUntilReset } from './rate-limit'

type Sql = Parameters<typeof checkRateLimit>[0]

/** A fake `sql` tagged-template that returns a fixed upsert result. */
function fakeSql(result: { count: number; window_start: string } | null): Sql {
  const fn = vi.fn(async () => (result ? [result] : []))
  return fn as unknown as Sql
}

describe('clientIp', () => {
  it('takes the first entry and trims it', () => {
    expect(clientIp('1.2.3.4, 5.6.7.8')).toBe('1.2.3.4')
    expect(clientIp(['9.9.9.9, 1.1.1.1'])).toBe('9.9.9.9')
  })
  it('falls back to "unknown"', () => {
    expect(clientIp(undefined)).toBe('unknown')
    expect(clientIp('')).toBe('unknown')
    expect(clientIp('   ')).toBe('unknown')
  })
})

describe('secondsUntilReset', () => {
  it('returns whole seconds remaining, floor 1', () => {
    const start = new Date('2026-01-01T00:00:00Z')
    const now = new Date('2026-01-01T00:00:10Z').getTime()
    expect(secondsUntilReset(start, 60, now)).toBe(50)
  })
  it('never returns 0 or negative once the window has passed', () => {
    const start = new Date('2026-01-01T00:00:00Z')
    const now = new Date('2026-01-01T00:05:00Z').getTime()
    expect(secondsUntilReset(start, 60, now)).toBe(1)
  })
})

describe('checkRateLimit', () => {
  it('allows when the post-write count is at or below the limit', async () => {
    const res = await checkRateLimit(fakeSql({ count: 5, window_start: new Date().toISOString() }), 'b', 5, 60)
    expect(res.ok).toBe(true)
    expect(res.retryAfter).toBe(0)
  })

  it('blocks when the count exceeds the limit and reports a retry delay', async () => {
    const res = await checkRateLimit(
      fakeSql({ count: 6, window_start: new Date().toISOString() }),
      'b',
      5,
      60,
    )
    expect(res.ok).toBe(false)
    expect(res.retryAfter).toBeGreaterThan(0)
    expect(res.retryAfter).toBeLessThanOrEqual(60)
  })

  it('fails open when the query throws', async () => {
    const throwing = (() => {
      throw new Error('no such table')
    }) as unknown as Sql
    const res = await checkRateLimit(throwing, 'b', 1, 60)
    expect(res.ok).toBe(true)
  })

  it('fails open when the upsert returns nothing', async () => {
    const res = await checkRateLimit(fakeSql(null), 'b', 1, 60)
    expect(res.ok).toBe(true)
  })
})
