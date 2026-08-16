import { describe, expect, it } from 'vitest'
import { parseImportedButtons, serializeButtons } from '../../src/shared/backup'
import type { Button } from '../../src/shared/types'

describe('serializeButtons', () => {
  it('serializes buttons to a JSON array of name/prompt pairs, dropping id and order', () => {
    const buttons: Button[] = [
      { id: '1', name: 'Summarize', order: 0, prompt: 'Summarize this.', type: 'prompt' },
      { id: '2', name: 'Translate', order: 1, prompt: 'Translate this.', type: 'prompt' },
    ]
    const json = serializeButtons(buttons)
    expect(JSON.parse(json)).toEqual([
      { name: 'Summarize', prompt: 'Summarize this.', type: 'prompt' },
      { name: 'Translate', prompt: 'Translate this.', type: 'prompt' },
    ])
  })

  it('serializes an empty list to an empty array', () => {
    expect(JSON.parse(serializeButtons([]))).toEqual([])
  })

  it('includes each button\'s type in the exported JSON', () => {
    const buttons: Button[] = [
      { id: '1', name: 'Summarize', order: 0, prompt: 'Summarize this.', type: 'prompt' },
      { id: '2', name: 'Doc Summary', order: 1, prompt: '/doc-summary', type: 'skill' },
    ]
    const json = serializeButtons(buttons)
    expect(JSON.parse(json)).toEqual([
      { name: 'Summarize', prompt: 'Summarize this.', type: 'prompt' },
      { name: 'Doc Summary', prompt: '/doc-summary', type: 'skill' },
    ])
  })
})

describe('parseImportedButtons', () => {
  it('parses a valid array of name/prompt pairs', () => {
    const json = JSON.stringify([
      { name: 'Summarize', prompt: 'Summarize this.' },
      { name: 'Translate', prompt: 'Translate this.' },
    ])
    expect(parseImportedButtons(json)).toEqual([
      { name: 'Summarize', prompt: 'Summarize this.', type: 'prompt' },
      { name: 'Translate', prompt: 'Translate this.', type: 'prompt' },
    ])
  })

  it('ignores extra fields like id or order on each entry', () => {
    const json = JSON.stringify([{ id: 'x', order: 5, name: 'Summarize', prompt: 'Summarize this.' }])
    expect(parseImportedButtons(json)).toEqual([
      { name: 'Summarize', prompt: 'Summarize this.', type: 'prompt' },
    ])
  })

  it('returns an empty array for an empty JSON array', () => {
    expect(parseImportedButtons('[]')).toEqual([])
  })

  it('throws a descriptive error for invalid JSON', () => {
    expect(() => parseImportedButtons('not json')).toThrow("That file isn't valid JSON.")
  })

  it('throws a descriptive error when the top level is not an array', () => {
    expect(() => parseImportedButtons('{"name":"x","prompt":"y"}')).toThrow(
      'Expected a JSON array of tools.',
    )
  })

  it('throws a descriptive error when an entry is not an object', () => {
    expect(() => parseImportedButtons('["not an object"]')).toThrow("Tool 1 isn't a valid object.")
  })

  it('throws a descriptive error when an entry is missing a name', () => {
    expect(() => parseImportedButtons(JSON.stringify([{ prompt: 'Summarize this.' }]))).toThrow(
      'Tool 1 is missing a name.',
    )
  })

  it('throws a descriptive error when an entry is missing a prompt', () => {
    expect(() => parseImportedButtons(JSON.stringify([{ name: 'Summarize' }]))).toThrow(
      'Tool 1 is missing a prompt.',
    )
  })

  it('reports the correct 1-based index for the second entry', () => {
    const json = JSON.stringify([{ name: 'Summarize', prompt: 'Summarize this.' }, { name: 'Bad' }])
    expect(() => parseImportedButtons(json)).toThrow('Tool 2 is missing a prompt.')
  })

  it('preserves type: "skill" on import', () => {
    const json = JSON.stringify([{ name: 'Doc Summary', prompt: '/doc-summary', type: 'skill' }])
    expect(parseImportedButtons(json)).toEqual([{ name: 'Doc Summary', prompt: '/doc-summary', type: 'skill' }])
  })

  it('defaults a missing type to "prompt" on import', () => {
    const json = JSON.stringify([{ name: 'Summarize', prompt: 'Summarize this.' }])
    expect(parseImportedButtons(json)).toEqual([
      { name: 'Summarize', prompt: 'Summarize this.', type: 'prompt' },
    ])
  })

  it('defaults an unrecognized type value to "prompt" on import', () => {
    const json = JSON.stringify([{ name: 'Weird', prompt: 'hi', type: 'bogus' }])
    expect(parseImportedButtons(json)).toEqual([{ name: 'Weird', prompt: 'hi', type: 'prompt' }])
  })
})
