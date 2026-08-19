import { describe, expect, it } from 'vitest'
import { parseOrgPromptsResponse } from '../../src/shared/org-prompts'

describe('parseOrgPromptsResponse', () => {
  it('parses a matched org with prompts, including each prompt id', () => {
    const raw = {
      org: { name: 'Acme' },
      prompts: [
        { id: 'p1', name: 'Summarize', prompt_text: 'Summarize this.', type: 'prompt' },
        { id: 'p2', name: 'Doc Summary', prompt_text: '/doc-summary', type: 'skill' },
      ],
    }
    expect(parseOrgPromptsResponse(raw)).toEqual({
      orgName: 'Acme',
      prompts: [
        { id: 'p1', name: 'Summarize', promptText: 'Summarize this.', type: 'prompt' },
        { id: 'p2', name: 'Doc Summary', promptText: '/doc-summary', type: 'skill' },
      ],
    })
  })

  it('returns a null org name and empty prompts when org is null', () => {
    expect(parseOrgPromptsResponse({ org: null, prompts: [] })).toEqual({ orgName: null, prompts: [] })
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

  it('skips a prompt entry missing an id', () => {
    const raw = { org: { name: 'Acme' }, prompts: [{ name: 'X', prompt_text: 'y', type: 'prompt' }] }
    expect(parseOrgPromptsResponse(raw).prompts).toEqual([])
  })

  it('returns null org name and empty prompts for non-object input, without throwing', () => {
    expect(parseOrgPromptsResponse(null)).toEqual({ orgName: null, prompts: [] })
    expect(parseOrgPromptsResponse(undefined)).toEqual({ orgName: null, prompts: [] })
    expect(parseOrgPromptsResponse('nope')).toEqual({ orgName: null, prompts: [] })
  })

  it('returns empty prompts when the prompts field is missing entirely', () => {
    expect(parseOrgPromptsResponse({ org: { name: 'Acme' } })).toEqual({ orgName: 'Acme', prompts: [] })
  })
})
