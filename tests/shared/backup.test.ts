import { describe, expect, it } from 'vitest'
import { parseBackup, serializeBackup } from '../../src/shared/backup'
import showcase from '../../examples/showcase.json'
import type { Button, ToolTab } from '../../src/shared/types'

const GENERAL: ToolTab = { id: 't1', name: 'General', emoji: null, order: 0 }
const MARKETING: ToolTab = { id: 't2', name: 'Marketing', emoji: '📣', order: 1 }

describe('serializeBackup', () => {
  it('writes a v2 payload with tabs and tools referenced by tab name', () => {
    const buttons: Button[] = [
      { id: '1', tabId: 't1', name: 'Summarize', order: 0, prompt: 'Summarize this.', type: 'prompt' },
      { id: '2', tabId: 't2', name: 'Ad Copy', order: 0, prompt: 'Write an ad.', type: 'skill' },
    ]
    expect(JSON.parse(serializeBackup([GENERAL, MARKETING], buttons))).toEqual({
      version: 2,
      tabs: [
        { name: 'General', emoji: null },
        { name: 'Marketing', emoji: '📣' },
      ],
      tools: [
        { tab: 'General', name: 'Summarize', prompt: 'Summarize this.', type: 'prompt' },
        { tab: 'Marketing', name: 'Ad Copy', prompt: 'Write an ad.', type: 'skill' },
      ],
    })
  })

  it('falls back to "General" as the tab name for a button whose tab is not in the list', () => {
    const buttons: Button[] = [
      { id: '1', tabId: 'orphan', name: 'Lost', order: 0, prompt: 'x', type: 'prompt' },
    ]
    expect(JSON.parse(serializeBackup([GENERAL], buttons)).tools[0].tab).toBe('General')
  })

  it('serializes an empty workspace', () => {
    expect(JSON.parse(serializeBackup([], []))).toEqual({ version: 2, tabs: [], tools: [] })
  })
})

describe('parseBackup - v1 (bare array, pre-tabs)', () => {
  it('parses a bare array and puts every tool in a General tab', () => {
    const json = JSON.stringify([
      { name: 'Summarize', prompt: 'Summarize this.' },
      { name: 'Doc Summary', prompt: '/doc-summary', type: 'skill' },
    ])
    expect(parseBackup(json)).toEqual({
      tabs: [{ name: 'General', emoji: null }],
      tools: [
        { tab: 'General', name: 'Summarize', prompt: 'Summarize this.', type: 'prompt' },
        { tab: 'General', name: 'Doc Summary', prompt: '/doc-summary', type: 'skill' },
      ],
    })
  })

  it('ignores extra fields like id or order on each entry', () => {
    const json = JSON.stringify([{ id: 'x', order: 5, name: 'Summarize', prompt: 'Summarize this.' }])
    expect(parseBackup(json).tools).toEqual([
      { tab: 'General', name: 'Summarize', prompt: 'Summarize this.', type: 'prompt' },
    ])
  })

  it('parses an empty array', () => {
    expect(parseBackup('[]')).toEqual({ tabs: [{ name: 'General', emoji: null }], tools: [] })
  })

  it('defaults an unrecognized type to "prompt"', () => {
    const json = JSON.stringify([{ name: 'Weird', prompt: 'hi', type: 'bogus' }])
    expect(parseBackup(json).tools[0].type).toBe('prompt')
  })
})

describe('parseBackup - v2', () => {
  it('round-trips a serialized v2 backup', () => {
    const buttons: Button[] = [
      { id: '1', tabId: 't1', name: 'Summarize', order: 0, prompt: 'Summarize this.', type: 'prompt' },
      { id: '2', tabId: 't2', name: 'Ad Copy', order: 0, prompt: 'Write an ad.', type: 'skill' },
    ]
    const json = serializeBackup([GENERAL, MARKETING], buttons)
    expect(parseBackup(json)).toEqual({
      tabs: [
        { name: 'General', emoji: null },
        { name: 'Marketing', emoji: '📣' },
      ],
      tools: [
        { tab: 'General', name: 'Summarize', prompt: 'Summarize this.', type: 'prompt' },
        { tab: 'Marketing', name: 'Ad Copy', prompt: 'Write an ad.', type: 'skill' },
      ],
    })
  })

  it('adds a missing tab that a tool references', () => {
    const json = JSON.stringify({
      version: 2,
      tabs: [{ name: 'General', emoji: null }],
      tools: [{ tab: 'Research', name: 'Cite', prompt: 'cite it', type: 'prompt' }],
    })
    expect(parseBackup(json).tabs).toEqual([
      { name: 'General', emoji: null },
      { name: 'Research', emoji: null },
    ])
  })

  it('defaults a tool with no tab field to General', () => {
    const json = JSON.stringify({
      version: 2,
      tabs: [],
      tools: [{ name: 'Loose', prompt: 'x', type: 'prompt' }],
    })
    const result = parseBackup(json)
    expect(result.tools[0].tab).toBe('General')
    expect(result.tabs).toEqual([{ name: 'General', emoji: null }])
  })
})

describe('parseBackup - errors (nothing is written on bad input)', () => {
  it('throws for invalid JSON', () => {
    expect(() => parseBackup('not json')).toThrow("That file isn't valid JSON.")
  })

  it('throws for a non-array, non-object top level', () => {
    expect(() => parseBackup('"a string"')).toThrow('Expected a tools array or a backup object.')
  })

  it('throws for an object without a recognized version', () => {
    expect(() => parseBackup('{"tools":[]}')).toThrow('Unsupported backup version. Expected 2.')
  })

  it('throws when a v2 backup has no tools array', () => {
    expect(() => parseBackup('{"version":2,"tabs":[]}')).toThrow('Backup is missing its "tools" array.')
  })

  it('throws when an entry is not an object', () => {
    expect(() => parseBackup('["not an object"]')).toThrow("Tool 1 isn't a valid object.")
  })

  it('throws when an entry is missing a name', () => {
    expect(() => parseBackup(JSON.stringify([{ prompt: 'x' }]))).toThrow('Tool 1 is missing a name.')
  })

  it('throws when an entry is missing a prompt', () => {
    expect(() => parseBackup(JSON.stringify([{ name: 'X' }]))).toThrow('Tool 1 is missing a prompt.')
  })

  it('reports the correct 1-based index for a later bad entry', () => {
    const json = JSON.stringify([{ name: 'ok', prompt: 'ok' }, { name: 'Bad' }])
    expect(() => parseBackup(json)).toThrow('Tool 2 is missing a prompt.')
  })
})

describe('examples/showcase.json', () => {
  it('is a valid v2 backup that imports cleanly', () => {
    const result = parseBackup(JSON.stringify(showcase))
    expect(result.tools.length).toBeGreaterThan(15)
    expect(result.tools.some((t) => t.type === 'skill')).toBe(true)
    // every tool's tab exists in the tab list
    const names = new Set(result.tabs.map((t) => t.name.toLowerCase()))
    for (const tool of result.tools) expect(names.has(tool.tab.toLowerCase())).toBe(true)
  })
})
