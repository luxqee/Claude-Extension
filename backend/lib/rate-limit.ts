import type { NeonQueryFunction } from '@neondatabase/serverless'

type Sql = NeonQueryFunction<false, false>

export interface RateLimitResult {
  ok: boolean
  /** Seconds until the current window resets. 0 when `ok`. */
  retryAfter: number
}

/** Seconds left in a fixed window that started at `windowStart`. */
export function secondsUntilReset(
  windowStart: Date,
  windowSeconds: number,
  now: number = Date.now(),
): number {
  const elapsed = (now - windowStart.getTime()) / 1000
  return Math.max(1, Math.ceil(windowSeconds - elapsed))
}

/**
 * Fixed-window counter in the `rate_limits` table. One atomic upsert per
 * call: it resets the window if the stored one has aged out, otherwise
 * increments. `count` after the write is compared against `limit`.
 *
 * Fail-open: any error (table missing, DB blip) returns `{ ok: true }` --
 * a rate limiter must never be the reason a legitimate request 500s.
 */
export async function checkRateLimit(
  sql: Sql,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  try {
    // ~1% of calls also sweep rows whose window ended over a day ago, so
    // the table can't grow without bound and needs no cron.
    if (Math.random() < 0.01) {
      await sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`
    }

    const rows = (await sql`
      INSERT INTO rate_limits (bucket, window_start, count)
      VALUES (${bucket}, now(), 1)
      ON CONFLICT (bucket) DO UPDATE SET
        count = CASE
          WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
          THEN 1 ELSE rate_limits.count + 1 END,
        window_start = CASE
          WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
          THEN now() ELSE rate_limits.window_start END
      RETURNING count, window_start
    `) as { count: number; window_start: string }[]

    const row = rows[0]
    if (!row) return { ok: true, retryAfter: 0 }
    if (row.count <= limit) return { ok: true, retryAfter: 0 }
    return { ok: false, retryAfter: secondsUntilReset(new Date(row.window_start), windowSeconds) }
  } catch (error) {
    console.error('[rate-limit] check failed, allowing request', error)
    return { ok: true, retryAfter: 0 }
  }
}

/** First IP in an `x-forwarded-for` header, or `'unknown'`. */
export function clientIp(forwardedFor: string | string[] | undefined): string {
  const raw = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor
  if (typeof raw !== 'string' || raw.trim().length === 0) return 'unknown'
  return raw.split(',')[0].trim()
}
