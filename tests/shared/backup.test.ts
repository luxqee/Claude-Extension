import { describe, expect, it } from 'vitest'
import { parseImportedButtons, serializeButtons } from '../../src/shared/backup'
import type { Button } from '../../src/shared/types'

describe('serializeButtons', () => {
  it('serializes buttons to a JSON array of name/prompt pairs, dropping id and order', () => {
    const buttons: Button[] = [
      { id: '1', name: 'Summarize', order: 0, prompt: 'Summarize this.' },
      { id: '2', name: 'Translate', order: 1, prompt: 'Translate this.' },
    ]
    const json = serializeButtons(buttons)
    expect(JSON.parse(json)).toEqual([
      { name: 'Summarize', prompt: 'Summarize this.' },
      { name: 'Translate', prompt: 'Translate this.' },
    ])
  })

  it('serializes an empty list to an empty array', () => {
    expect(JSON.parse(serializeButtons([]))).toEqual([])
  })
})

describe('parseImportedButtons', () => {
  it('parses a valid array of name/prompt pairs', () => {
    const json = JSON.stringify([
      { name: 'Summarize', prompt: 'Summarize this.' },
      { name: 'Translate', prompt: 'Translate this.' },
    ])
    expect(parseImportedButtons(json)).toEqual([
      { name: 'Summarize', prompt: 'Summarize this.' },
      { name: 'Translate', prompt: 'Translate this.' },
    ])
  })

  it('ignores extra fields like id or order on each entry', () => {
    const json = JSON.stringify([{ id: 'x', order: 5, name: 'Summarize', prompt: 'Summarize this.' }])
    expect(parseImportedButtons(json)).toEqual([{ name: 'Summarize', prompt: 'Summarize this.' }])
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
})
