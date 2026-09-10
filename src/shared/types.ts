export type ButtonType = 'prompt' | 'skill'

/** The name given to the tab that existing buttons are migrated into, and
 * the tab created for a brand-new install. */
export const DEFAULT_TAB_NAME = 'General'

export interface ToolTab {
  id: string
  name: string
  /** A single emoji shown before the tab name, or null for none. */
  emoji: string | null
  /** Position among the personal tabs, ascending. */
  order: number
}

export interface Button {
  id: string
  /** The tab this button belongs to. Every button belongs to exactly one
   * tab (guaranteed by the storage-layer migration and by ToolService). */
  tabId: string
  name: string
  /** Position within its own tab, ascending. */
  order: number
  prompt: string
  type: ButtonType
}
