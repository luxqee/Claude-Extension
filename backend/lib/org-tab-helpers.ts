// Pure helpers shared by the org-tab and org-prompt endpoints.

/** The sort_order to give a newly appended row: one past the current max,
 * or 0 when there are none. */
export function nextSortOrder(existing: number[]): number {
  return existing.length === 0 ? 0 : Math.max(...existing) + 1
}

/** True when a tab may be deleted -- an organisation must always keep at
 * least one tab. */
export function canDeleteTab(currentTabCount: number): boolean {
  return currentTabCount > 1
}

/**
 * Given the org's tab ids in their current order and a client-supplied
 * desired order, returns the final id list: ids named by the client take
 * that order; any omitted id keeps its place afterwards. Unknown ids in
 * the client list are ignored.
 */
export function applyTabReorder(currentIds: string[], requestedOrder: string[]): string[] {
  const known = new Set(currentIds)
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const id of requestedOrder) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id)
      ordered.push(id)
    }
  }
  for (const id of currentIds) {
    if (!seen.has(id)) ordered.push(id)
  }
  return ordered
}

/**
 * When a tab is deleted, the tab its prompts move to: the first remaining
 * tab by sort_order. Returns null when no other tab exists (caller must
 * have already refused the delete via canDeleteTab).
 */
export function pickFallbackTabId(
  tabsBySortOrder: { id: string }[],
  deletingId: string,
): string | null {
  return tabsBySortOrder.find((t) => t.id !== deletingId)?.id ?? null
}
