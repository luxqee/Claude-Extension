export interface OrgPrompt {
  name: string
  promptText: string
  type: 'prompt' | 'skill'
}

export interface OrgPromptsResult {
  orgName: string | null
  prompts: OrgPrompt[]
}

export const API_BASE_URL = 'https://claude-extension-git-main-luxqees-projects.vercel.app'
const CACHE_STORAGE_KEY = 'orgPromptsCache'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parsePrompt(entry: unknown): OrgPrompt | null {
  if (!isRecord(entry)) return null
  const name = entry.name
  const promptText = entry.prompt_text
  const type = entry.type
  if (typeof name !== 'string' || typeof promptText !== 'string') return null
  if (type !== 'prompt' && type !== 'skill') return null
  return { name, promptText, type }
}

export function parseOrgPromptsResponse(raw: unknown): OrgPromptsResult {
  if (!isRecord(raw)) return { orgName: null, prompts: [] }

  const org = raw.org
  const orgName = isRecord(org) && typeof org.name === 'string' ? org.name : null

  const prompts: OrgPrompt[] = []
  if (Array.isArray(raw.prompts)) {
    for (const entry of raw.prompts) {
      const prompt = parsePrompt(entry)
      if (prompt) prompts.push(prompt)
    }
  }

  return { orgName, prompts }
}

export async function fetchOrgPrompts(idToken: string): Promise<OrgPromptsResult | null> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/org-prompts`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
  } catch (error) {
    console.error('[Claude Tools] failed to fetch org prompts', error)
    return null
  }

  if (!response.ok) {
    console.error('[Claude Tools] org-prompts endpoint returned status', response.status)
    return null
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    console.error('[Claude Tools] org-prompts response was not valid JSON', error)
    return null
  }

  return parseOrgPromptsResponse(body)
}

export async function getCachedOrgPrompts(): Promise<OrgPromptsResult | null> {
  const stored = await chrome.storage.local.get(CACHE_STORAGE_KEY)
  const cached = stored[CACHE_STORAGE_KEY]
  return cached ? (cached as OrgPromptsResult) : null
}

async function setCachedOrgPrompts(result: OrgPromptsResult): Promise<void> {
  await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: result })
}

export async function clearCachedOrgPrompts(): Promise<void> {
  await chrome.storage.local.remove(CACHE_STORAGE_KEY)
}

export async function loadOrgPrompts(idToken: string): Promise<OrgPromptsResult> {
  const fresh = await fetchOrgPrompts(idToken)
  if (fresh) {
    await setCachedOrgPrompts(fresh)
    return fresh
  }
  const cached = await getCachedOrgPrompts()
  return cached ?? { orgName: null, prompts: [] }
}
