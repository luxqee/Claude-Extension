import type { Button } from './types'

// Client-only usage counters for personal buttons. Stored in
// chrome.storage.local, never sent anywhere. Counts an insertion (the
// existing "run" action) -- nothing is ever auto-sent.

const USAGE_KEY = 'buttonUsage'

export interface ButtonUsage {
  count: number
  /** ms since epoch of the most recent run. */
  lastUsedAt: number
}

export type ButtonUsageMap = Record<string, ButtonUsage>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseButtonUsage(raw: unknown): ButtonUsageMap {
  if (!isRecord(raw)) return {}
  const out: ButtonUsageMap = {}
  for (const [id, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) continue
    const count = typeof entry.count === 'number' && entry.count >= 0 ? Math.floor(entry.count) : 0
    const lastUsedAt = typeof entry.lastUsedAt === 'number' && entry.lastUsedAt >= 0 ? entry.lastUsedAt : 0
    if (count > 0) out[id] = { count, lastUsedAt }
  }
  return out
}

export async function getButtonUsage(): Promise<ButtonUsageMap> {
  const stored = await chrome.storage.local.get(USAGE_KEY)
  return parseButtonUsage(stored[USAGE_KEY])
}

export async function recordButtonRun(id: string, now: number = Date.now()): Promise<void> {
  const usage = await getButtonUsage()
  const prev = usage[id]
  usage[id] = { count: (prev?.count ?? 0) + 1, lastUsedAt: now }
  await chrome.storage.local.set({ [USAGE_KEY]: usage })
}

/** Drops counters for buttons that no longer exist, keeping the store from
 * growing without bound. Safe to call on load. */
export async function pruneButtonUsage(liveButtonIds: Iterable<string>): Promise<void> {
  const usage = await getButtonUsage()
  const live = new Set(liveButtonIds)
  let changed = false
  for (const id of Object.keys(usage)) {
    if (!live.has(id)) {
      delete usage[id]
      changed = true
    }
  }
  if (changed) await chrome.storage.local.set({ [USAGE_KEY]: usage })
}

/**
 * Returns `buttons` ordered by run count descending, then by their
 * existing order for ties and unused buttons. Pure -- does not mutate the
 * input.
 */
export function sortButtonsByMostUsed(buttons: Button[], usage: ButtonUsageMap): Button[] {
  return buttons
    .map((button, index) => ({ button, index, count: usage[button.id]?.count ?? 0 }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.index - b.index))
    .map((entry) => entry.button)
}
