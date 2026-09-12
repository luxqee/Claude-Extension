import { describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { withRateLimit } from './with-rate-limit'

type Sql = Parameters<typeof withRateLimit>[0]

function fakeSql(count: number): Sql {
  return vi.fn(async () => [{ count, window_start: new Date().toISOString() }]) as unknown as Sql
}

function makeReqRes(ip = '1.2.3.4'): { req: VercelRequest; res: VercelResponse & { statusCode: number; body: unknown; headers: Record<string, string> } } {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value
    },
    end() {
      return this
    },
  }
  const req = { headers: { 'x-forwarded-for': ip } } as unknown as VercelRequest
  return { req, res: res as unknown as VercelResponse & { statusCode: number; body: unknown; headers: Record<string, string> } }
}

describe('withRateLimit', () => {
  it('calls the wrapped handler when under the limit', async () => {
    const inner = vi.fn(async (_req: VercelRequest, res: VercelResponse) => {
      res.status(200).json({ ok: true })
    })
    const wrapped = withRateLimit(fakeSql(1), 'test-route', 5, 60)(inner)
    const { req, res } = makeReqRes()

    await wrapped(req, res)

    expect(inner).toHaveBeenCalledOnce()
    expect(res.statusCode).toBe(200)
  })

  it('returns 429 with Retry-After and never calls the handler when over the limit', async () => {
    const inner = vi.fn(async (_req: VercelRequest, res: VercelResponse) => {
      res.status(200).json({ ok: true })
    })
    const wrapped = withRateLimit(fakeSql(999), 'test-route', 5, 60)(inner)
    const { req, res } = makeReqRes()

    await wrapped(req, res)

    expect(inner).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(429)
    expect(res.headers['Retry-After']).toBeDefined()
  })

  it('keys the bucket by the request\'s IP, not a fixed string', async () => {
    // Reconstructs each tagged-template call into plain text (strings +
    // values interleaved) so the bucket -- wherever it lands among the
    // substitutions -- is easy to search for, rather than assuming a
    // fixed argument position that could shift with the query's shape.
    const queries: string[] = []
    const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push(strings.reduce((acc, s, i) => acc + s + (values[i] ?? ''), ''))
      return Promise.resolve([{ count: 1, window_start: new Date().toISOString() }])
    }) as unknown as Sql

    const inner = vi.fn(async (_req: VercelRequest, res: VercelResponse) => {
      res.status(200).json({ ok: true })
    })
    const wrapped = withRateLimit(sql, 'test-route', 5, 60)(inner)
    const { req, res } = makeReqRes('9.9.9.9')

    await wrapped(req, res)

    expect(res.statusCode).toBe(200)
    expect(queries.some((q) => q.includes('test-route:9.9.9.9'))).toBe(true)
  })
})
