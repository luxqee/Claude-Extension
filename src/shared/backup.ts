import type { Button } from './types'

export interface ImportedTool {
  name: string
  prompt: string
}

export function serializeButtons(buttons: Button[]): string {
  const exportable: ImportedTool[] = buttons.map((button) => ({
    name: button.name,
    prompt: button.prompt,
  }))
  return JSON.stringify(exportable, null, 2)
}

export function parseImportedButtons(json: string): ImportedTool[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error("That file isn't valid JSON.")
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Expected a JSON array of tools.')
  }

  return parsed.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`Tool ${index + 1} isn't a valid object.`)
    }
    const { name, prompt } = item as Record<string, unknown>
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error(`Tool ${index + 1} is missing a name.`)
    }
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new Error(`Tool ${index + 1} is missing a prompt.`)
    }
    return { name, prompt }
  })
}
