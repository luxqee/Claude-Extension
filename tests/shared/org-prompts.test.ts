import { describe, expect, it } from 'vitest'
import { parseOrgPromptsResponse } from '../../src/shared/org-prompts'

describe('parseOrgPromptsResponse', () => {
  it('parses a matched org with tabs and prompts, mapping snake_case fields', () => {
    const raw = {
      org: { name: 'Acme' },
      tabs: [
        { id: 't2', name: 'Marketing', emoji: '📣', sort_order: 1 },
        { id: 't1', name: 'General', emoji: null, sort_order: 0 },
      ],
      prompts: [
        { id: 'p2', name: 'Doc Summary', prompt_text: '/doc-summary', type: 'skill', tab_id: 't2', sort_order: 1 },
        { id: 'p1', name: 'Summarize', prompt_text: 'Summarize this.', type: 'prompt', tab_id: 't1', sort_order: 0 },
      ],
    }
    expect(parseOrgPromptsResponse(raw)).toEqual({
      orgName: 'Acme',
      tabs: [
        { id: 't1', name: 'General', emoji: null, sortOrder: 0 },
        { id: 't2', name: 'Marketing', emoji: '📣', sortOrder: 1 },
      ],
      prompts: [
        { id: 'p1', name: 'Summarize', promptText: 'Summarize this.', type: 'prompt', tabId: 't1', sortOrder: 0 },
        { id: 'p2', name: 'Doc Summary', promptText: '/doc-summary', type: 'skill', tabId: 't2', sortOrder: 1 },
      ],
    })
  })

  it('defaults tabId to null and sortOrder to 0 for a legacy prompt row', () => {
    const raw = { org: { name: 'Acme' }, prompts: [{ id: 'p1', name: 'S', prompt_text: 'x', type: 'prompt' }] }
    expect(parseOrgPromptsResponse(raw).prompts[0]).toEqual({
      id: 'p1',
      name: 'S',
      promptText: 'x',
      type: 'prompt',
      tabId: null,
      sortOrder: 0,
    })
  })

  it('returns a null org name and empty tabs/prompts when org is null', () => {
    expect(parseOrgPromptsResponse({ org: null, prompts: [] })).toEqual({
      orgName: null,
      tabs: [],
      prompts: [],
    })
  })

  it('skips a prompt entry missing required fields instead of throwing', () => {
    const raw = { org: { name: 'Acme' }, prompts: [{ id: 'p1', name: 'Bad' }] }
    expect(() => parseOrgPromptsResponse(raw)).not.toThrow()
    expect(parseOrgPromptsResponse(raw).prompts).toEqual([])
  })

  it('skips a prompt entry with an unrecognized type', () => {
    const raw = { org: { name: 'Acme' }, prompts: [{ name: 'X', prompt_text: 'y', type: 'bogus' }] }
    expect(parseOrgPromptsResponse(raw).prompts).toEqual([])
  })

  it('skips a tab entry with no name', () => {
    const raw = { org: { name: 'Acme' }, tabs: [{ id: 't1' }], prompts: [] }
    expect(parseOrgPromptsResponse(raw).tabs).toEqual([])
  })

  it('returns null org name and empty tabs/prompts for non-object input, without throwing', () => {
    for (const input of [null, undefined, 'nope']) {
      expect(parseOrgPromptsResponse(input)).toEqual({ orgName: null, tabs: [], prompts: [] })
    }
  })

  it('returns empty tabs/prompts when those fields are missing entirely', () => {
    expect(parseOrgPromptsResponse({ org: { name: 'Acme' } })).toEqual({
      orgName: 'Acme',
      tabs: [],
      prompts: [],
    })
  })
})
