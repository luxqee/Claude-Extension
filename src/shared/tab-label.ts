// A tab's display label is one text field: an optional leading emoji then
// the name (e.g. "🚀 Launch"). These helpers split that single string
// into the stored { emoji, name } pair and join it back, so the UI can
// show one input instead of two.

const LEADING_EMOJI = /^((?:\p{Extended_Pictographic}(?:️|‍)?)+)\s*/u

export function splitTabLabel(value: string): { emoji: string | null; name: string } {
  const trimmed = value.trim()
  const match = LEADING_EMOJI.exec(trimmed)
  if (match) {
    const name = trimmed.slice(match[0].length).trim()
    return { emoji: match[1], name }
  }
  return { emoji: null, name: trimmed }
}

export function joinTabLabel(emoji: string | null, name: string): string {
  return emoji ? `${emoji} ${name}` : name
}
