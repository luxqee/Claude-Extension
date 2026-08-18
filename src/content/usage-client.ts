import { parseUsageResponse } from '../shared/usage'
import type { GetUsageResponse } from '../shared/messages'

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export async function fetchUsage(): Promise<GetUsageResponse> {
  const orgId = readCookie('lastActiveOrg')
  if (!orgId) {
    console.warn('[Claude Tools] no lastActiveOrg cookie found; cannot fetch usage')
    return { ok: false }
  }

  let response: Response
  try {
    response = await fetch(`https://claude.ai/api/organizations/${encodeURIComponent(orgId)}/usage`, {
      credentials: 'include',
    })
  } catch (error) {
    console.error('[Claude Tools] usage fetch failed', error)
    return { ok: false }
  }

  if (!response.ok) {
    console.error('[Claude Tools] usage endpoint returned status', response.status)
    return { ok: false }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    console.error('[Claude Tools] usage response was not valid JSON', error)
    return { ok: false }
  }

  return { ok: true, usage: parseUsageResponse(body) }
}
