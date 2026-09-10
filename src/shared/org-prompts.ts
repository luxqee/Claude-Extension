export interface OrgPrompt {
  id: string
  name: string
  promptText: string
  type: 'prompt' | 'skill'
  /** null only for legacy rows the Phase 5 backfill somehow missed. */
  tabId: string | null
  sortOrder: number
}

export interface OrgTab {
  id: string
  name: string
  emoji: string | null
  sortOrder: number
}

export interface OrgPromptsResult {
  orgName: string | null
  tabs: OrgTab[]
  prompts: OrgPrompt[]
}

const EMPTY_RESULT: OrgPromptsResult = { orgName: null, tabs: [], prompts: [] }

export { API_BASE_URL } from './api-base'
import { API_BASE_URL } from './api-base'
const CACHE_STORAGE_KEY = 'orgPromptsCache'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parsePrompt(entry: unknown): OrgPrompt | null {
  if (!isRecord(entry)) return null
  const id = entry.id
  const name = entry.name
  const promptText = entry.prompt_text
  const type = entry.type
  if (typeof id !== 'string' || typeof name !== 'string' || typeof promptText !== 'string') return null
  if (type !== 'prompt' && type !== 'skill') return null
  return {
    id,
    name,
    promptText,
    type,
    tabId: typeof entry.tab_id === 'string' ? entry.tab_id : null,
    sortOrder: typeof entry.sort_order === 'number' ? entry.sort_order : 0,
  }
}

function parseTab(entry: unknown): OrgTab | null {
  if (!isRecord(entry)) return null
  const id = entry.id
  const name = entry.name
  if (typeof id !== 'string' || typeof name !== 'string') return null
  return {
    id,
    name,
    emoji: typeof entry.emoji === 'string' && entry.emoji.length > 0 ? entry.emoji : null,
    sortOrder: typeof entry.sort_order === 'number' ? entry.sort_order : 0,
  }
}

export function parseOrgPromptsResponse(raw: unknown): OrgPromptsResult {
  if (!isRecord(raw)) return { ...EMPTY_RESULT }

  const org = raw.org
  const orgName = isRecord(org) && typeof org.name === 'string' ? org.name : null

  const tabs: OrgTab[] = []
  if (Array.isArray(raw.tabs)) {
    for (const entry of raw.tabs) {
      const tab = parseTab(entry)
      if (tab) tabs.push(tab)
    }
  }
  tabs.sort((a, b) => a.sortOrder - b.sortOrder)

  const prompts: OrgPrompt[] = []
  if (Array.isArray(raw.prompts)) {
    for (const entry of raw.prompts) {
      const prompt = parsePrompt(entry)
      if (prompt) prompts.push(prompt)
    }
  }
  prompts.sort((a, b) => a.sortOrder - b.sortOrder)

  return { orgName, tabs, prompts }
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
  return cached ?? { ...EMPTY_RESULT }
}

export interface CreateOrgPromptInput {
  name: string
  promptText: string
  type: 'prompt' | 'skill'
  tabId?: string
}

export async function createOrgPrompt(idToken: string, input: CreateOrgPromptInput): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/org-prompts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return response.ok
  } catch (error) {
    console.error('[Claude Tools] failed to create org prompt', error)
    return false
  }
}

export interface UpdateOrgPromptInput {
  name?: string
  promptText?: string
  type?: 'prompt' | 'skill'
  tabId?: string
}

export async function updateOrgPrompt(idToken: string, id: string, input: UpdateOrgPromptInput): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/org-prompts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return response.ok
  } catch (error) {
    console.error('[Claude Tools] failed to update org prompt', error)
    return false
  }
}

export async function deleteOrgPrompt(idToken: string, id: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/org-prompts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    })
    return response.ok
  } catch (error) {
    console.error('[Claude Tools] failed to delete org prompt', error)
    return false
  }
}

// --- shared (organisation) tabs ---

export interface CreateOrgTabInput {
  name: string
  emoji?: string | null
}

export async function createOrgTab(idToken: string, input: CreateOrgTabInput): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/org-tabs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: input.name, emoji: input.emoji ?? null }),
    })
    return response.ok
  } catch (error) {
    console.error('[Claude Tools] failed to create org tab', error)
    return false
  }
}

export interface UpdateOrgTabInput {
  name?: string
  emoji?: string | null
}

export async function updateOrgTab(idToken: string, id: string, input: UpdateOrgTabInput): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/org-tabs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return response.ok
  } catch (error) {
    console.error('[Claude Tools] failed to update org tab', error)
    return false
  }
}

export async function deleteOrgTab(
  idToken: string,
  id: string,
): Promise<{ ok: true } | { ok: false; status: number }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/org-tabs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    })
    return response.ok ? { ok: true } : { ok: false, status: response.status }
  } catch (error) {
    console.error('[Claude Tools] failed to delete org tab', error)
    return { ok: false, status: 0 }
  }
}

export async function reorderOrgTabs(idToken: string, orderedIds: string[]): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/org-tabs-reorder`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    })
    return response.ok
  } catch (error) {
    console.error('[Claude Tools] failed to reorder org tabs', error)
    return false
  }
}
