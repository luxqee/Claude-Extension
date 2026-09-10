import type { ButtonType } from './types'

/**
 * The little badge char shown before a tool/prompt name:
 * `/` for a skill invocation, `@` for a mention (either an @-prefixed
 * text or a skill whose invocation starts with @), otherwise none.
 */
export function badgeFor(type: ButtonType, text: string): '/' | '@' | null {
  const trimmed = text.trimStart()
  if (trimmed.startsWith('@')) return '@'
  if (type === 'skill' || trimmed.startsWith('/')) return '/'
  return null
}
