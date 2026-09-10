import { DEFAULT_TAB_NAME, type Button, type ButtonType, type ToolTab } from './types'

// Backup format v2. Tabs and buttons are referenced by tab *name*, never
// id -- ids are meaningless across installs. A v1 backup (a bare JSON
// array of tools, from before tabs existed) still imports: every tool
// lands in a "${DEFAULT_TAB_NAME}" tab.

export interface ImportedTab {
  name: string
  emoji: string | null
}

export interface ImportedTool {
  /** The name of the tab this tool belongs to. */
  tab: string
  name: string
  prompt: string
  type: ButtonType
}

export interface ParsedBackup {
  tabs: ImportedTab[]
  tools: ImportedTool[]
}

const BACKUP_VERSION = 2

function normalizeType(type: unknown): ButtonType {
  return type === 'skill' ? 'skill' : 'prompt'
}

function normalizeEmoji(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function serializeBackup(tabs: ToolTab[], buttons: Button[]): string {
  const tabNameById = new Map(tabs.map((t) => [t.id, t.name]))
  const payload = {
    version: BACKUP_VERSION,
    tabs: tabs.map((t) => ({ name: t.name, emoji: t.emoji })),
    tools: buttons.map((b) => ({
      tab: tabNameById.get(b.tabId) ?? DEFAULT_TAB_NAME,
      name: b.name,
      prompt: b.prompt,
      type: b.type,
    })),
  }
  return JSON.stringify(payload, null, 2)
}

function parseToolEntry(item: unknown, index: number, defaultTab: string): ImportedTool {
  if (typeof item !== 'object' || item === null) {
    throw new Error(`Tool ${index + 1} isn't a valid object.`)
  }
  const { name, prompt, type, tab } = item as Record<string, unknown>
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error(`Tool ${index + 1} is missing a name.`)
  }
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new Error(`Tool ${index + 1} is missing a prompt.`)
  }
  return {
    tab: typeof tab === 'string' && tab.trim().length > 0 ? tab : defaultTab,
    name,
    prompt,
    type: normalizeType(type),
  }
}

/**
 * Parses either format:
 * - v1: a bare JSON array of `{ name, prompt, type? }`. Every tool is put
 *   in a "${DEFAULT_TAB_NAME}" tab.
 * - v2: `{ version: 2, tabs: [{ name, emoji }], tools: [{ tab, name,
 *   prompt, type }] }`.
 * Throws a descriptive error and touches nothing on malformed input.
 */
export function parseBackup(json: string): ParsedBackup {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error("That file isn't valid JSON.")
  }

  // v1: bare array of tools.
  if (Array.isArray(parsed)) {
    const tools = parsed.map((item, index) => parseToolEntry(item, index, DEFAULT_TAB_NAME))
    return { tabs: [{ name: DEFAULT_TAB_NAME, emoji: null }], tools }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Expected a tools array or a backup object.')
  }
  const record = parsed as Record<string, unknown>

  if (record.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version. Expected ${BACKUP_VERSION}.`)
  }
  if (!Array.isArray(record.tools)) {
    throw new Error('Backup is missing its "tools" array.')
  }

  const tabs: ImportedTab[] = Array.isArray(record.tabs)
    ? record.tabs
        .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
        .map((t) => ({ name: t.name, emoji: normalizeEmoji(t.emoji) }))
        .filter((t): t is ImportedTab => typeof t.name === 'string' && t.name.trim().length > 0)
    : []

  const tools = record.tools.map((item, index) => parseToolEntry(item, index, DEFAULT_TAB_NAME))

  // Make sure every tab a tool references exists in the tab list, and that
  // there's always at least the default tab.
  const tabNames = new Set(tabs.map((t) => t.name.toLowerCase()))
  for (const tool of tools) {
    if (!tabNames.has(tool.tab.toLowerCase())) {
      tabs.push({ name: tool.tab, emoji: null })
      tabNames.add(tool.tab.toLowerCase())
    }
  }
  if (tabs.length === 0) tabs.push({ name: DEFAULT_TAB_NAME, emoji: null })

  return { tabs, tools }
}
