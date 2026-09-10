import { beforeEach, describe, expect, it } from 'vitest'
import { ChromeLocalStorageAdapter } from '../../../src/shared/storage/chrome-local-adapter'
import type { Button } from '../../../src/shared/types'

function installChromeStorageMock() {
  const store = new Map<string, unknown>()
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys: string | string[] | Record<string, unknown>) => {
          const names = Array.isArray(keys)
            ? keys
            : typeof keys === 'string'
              ? [keys]
              : Object.keys(keys)
          const out: Record<string, unknown> = {}
          for (const name of names) out[name] = store.get(name)
          return out
        },
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) store.set(key, value)
        },
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key)
        },
      },
    },
  } as unknown as typeof chrome
  return store
}

describe('ChromeLocalStorageAdapter', () => {
  let store: Map<string, unknown>
  let adapter: ChromeLocalStorageAdapter

  beforeEach(() => {
    store = installChromeStorageMock()
    adapter = new ChromeLocalStorageAdapter()
  })

  describe('v1 -> v2 migration', () => {
    it('creates a General tab and attaches every existing button to it', async () => {
      store.set('buttons', [
        { id: '1', name: 'A', order: 0, prompt: 'a', type: 'prompt' },
        { id: '2', name: 'B', order: 1, prompt: 'b', type: 'skill' },
      ])

      const tabs = await adapter.getTabs()
      expect(tabs).toHaveLength(1)
      expect(tabs[0].name).toBe('General')
      expect(tabs[0].order).toBe(0)

      const buttons = await adapter.getButtons()
      expect(buttons.map((b) => b.tabId)).toEqual([tabs[0].id, tabs[0].id])
      expect(buttons.map((b) => b.name)).toEqual(['A', 'B'])
      expect(buttons.map((b) => b.order)).toEqual([0, 1])
      expect(store.get('schemaVersion')).toBe(2)
    })

    it('is idempotent - a second read does not create another tab or change ids', async () => {
      store.set('buttons', [{ id: '1', name: 'A', order: 0, prompt: 'a' }])
      const firstTabs = await adapter.getTabs()
      const firstButtons = await adapter.getButtons()
      const secondTabs = await adapter.getTabs()
      const secondButtons = await adapter.getButtons()
      expect(secondTabs).toEqual(firstTabs)
      expect(secondButtons).toEqual(firstButtons)
    })

    it('gives a brand-new install (nothing stored) an empty General tab and no buttons', async () => {
      expect(await adapter.getButtons()).toEqual([])
      const tabs = await adapter.getTabs()
      expect(tabs).toHaveLength(1)
      expect(tabs[0].name).toBe('General')
    })

    it('keeps an already-present tab list instead of adding a second General', async () => {
      store.set('tabs', [{ id: 'keep', name: 'Kept', order: 0 }])
      store.set('buttons', [{ id: '1', name: 'A', order: 0, prompt: 'a' }])
      const tabs = await adapter.getTabs()
      expect(tabs.map((t) => t.name)).toEqual(['Kept'])
      const buttons = await adapter.getButtons()
      expect(buttons[0].tabId).toBe('keep')
    })

    it('defaults a missing type to "prompt" while migrating', async () => {
      store.set('buttons', [{ id: '1', name: 'Legacy', order: 0, prompt: 'hi' }])
      const [button] = await adapter.getButtons()
      expect(button.type).toBe('prompt')
    })
  })

  describe('buttons', () => {
    let tabId: string

    beforeEach(async () => {
      tabId = (await adapter.getTabs())[0].id
    })

    it('saves a new button and returns it', async () => {
      const button: Button = { id: '1', tabId, name: 'S', order: 0, prompt: 'p', type: 'prompt' }
      await adapter.saveButton(button)
      expect(await adapter.getButtons()).toEqual([button])
    })

    it('overwrites a button with the same id', async () => {
      await adapter.saveButton({ id: '1', tabId, name: 'Old', order: 0, prompt: 'old', type: 'prompt' })
      await adapter.saveButton({ id: '1', tabId, name: 'New', order: 0, prompt: 'new', type: 'prompt' })
      expect(await adapter.getButtons()).toEqual([
        { id: '1', tabId, name: 'New', order: 0, prompt: 'new', type: 'prompt' },
      ])
    })

    it('deletes a button by id', async () => {
      await adapter.saveButton({ id: '1', tabId, name: 'A', order: 0, prompt: 'a', type: 'prompt' })
      await adapter.saveButton({ id: '2', tabId, name: 'B', order: 1, prompt: 'b', type: 'prompt' })
      await adapter.deleteButton('1')
      expect((await adapter.getButtons()).map((b) => b.id)).toEqual(['2'])
    })

    it('drops malformed entries instead of crashing', async () => {
      store.set('buttons', [{ id: '1', name: 'Valid', order: 0, prompt: 'ok' }, { id: '2' }, null, 'garbage'])
      const buttons = await adapter.getButtons()
      expect(buttons).toHaveLength(1)
      expect(buttons[0].name).toBe('Valid')
    })

    it('self-heals an orphaned button onto the first tab', async () => {
      const realTabId = (await adapter.getTabs())[0].id
      store.set('buttons', [
        { id: '1', tabId: 'deleted-tab', name: 'Orphan', order: 0, prompt: 'x', type: 'prompt' },
      ])
      const [button] = await adapter.getButtons()
      expect(button.tabId).toBe(realTabId)
    })

    it('reorders buttons within a single tab', async () => {
      await adapter.saveButton({ id: '1', tabId, name: 'A', order: 0, prompt: 'a', type: 'prompt' })
      await adapter.saveButton({ id: '2', tabId, name: 'B', order: 1, prompt: 'b', type: 'prompt' })
      await adapter.reorderButtons(['2', '1'])
      const buttons = await adapter.getButtons()
      expect(buttons.map((b) => [b.id, b.order])).toEqual([
        ['2', 0],
        ['1', 1],
      ])
    })

    it('reorders each tab independently and keeps unlisted buttons in place', async () => {
      const second = { id: 's', name: 'Second', order: 1, emoji: null }
      await adapter.saveTab(second)
      await adapter.saveButton({ id: 'a', tabId, name: 'A', order: 0, prompt: 'a', type: 'prompt' })
      await adapter.saveButton({ id: 'b', tabId, name: 'B', order: 1, prompt: 'b', type: 'prompt' })
      await adapter.saveButton({ id: 'c', tabId, name: 'C', order: 2, prompt: 'c', type: 'prompt' })
      await adapter.saveButton({ id: 'x', tabId: 's', name: 'X', order: 0, prompt: 'x', type: 'prompt' })

      // Only mentions two of tab-1's buttons; 'c' and the other tab untouched.
      await adapter.reorderButtons(['b', 'a'])

      const byId = Object.fromEntries((await adapter.getButtons()).map((b) => [b.id, b.order]))
      expect([byId.b, byId.a, byId.c]).toEqual([0, 1, 2])
      expect(byId.x).toBe(0)
    })
  })

  describe('tabs', () => {
    it('saves, lists sorted by order, and overwrites by id', async () => {
      const general = (await adapter.getTabs())[0]
      await adapter.saveTab({ id: 'm', name: 'Marketing', order: 2, emoji: '📣' })
      await adapter.saveTab({ id: 'w', name: 'Writing', order: 1, emoji: null })
      expect((await adapter.getTabs()).map((t) => t.name)).toEqual([general.name, 'Writing', 'Marketing'])

      await adapter.saveTab({ id: 'm', name: 'Marketing & Sales', order: 2, emoji: '📣' })
      expect((await adapter.getTabs()).find((t) => t.id === 'm')?.name).toBe('Marketing & Sales')
    })

    it('deletes a tab and moves its buttons to the reassignment target', async () => {
      const general = (await adapter.getTabs())[0]
      await adapter.saveTab({ id: 'm', name: 'Marketing', order: 1, emoji: null })
      await adapter.saveButton({ id: 'k', tabId: 'm', name: 'Keep', order: 0, prompt: 'x', type: 'prompt' })
      await adapter.saveButton({ id: 'g', tabId: general.id, name: 'G', order: 0, prompt: 'g', type: 'prompt' })

      await adapter.deleteTab('m', general.id)

      expect((await adapter.getTabs()).map((t) => t.id)).toEqual([general.id])
      const buttons = await adapter.getButtons()
      expect(buttons.every((b) => b.tabId === general.id)).toBe(true)
      expect(buttons.find((b) => b.id === 'k')?.order).toBe(1)
    })

    it('deletes a tab and its buttons when the target is null', async () => {
      const general = (await adapter.getTabs())[0]
      await adapter.saveTab({ id: 'm', name: 'Marketing', order: 1, emoji: null })
      await adapter.saveButton({ id: 'k', tabId: 'm', name: 'Goner', order: 0, prompt: 'x', type: 'prompt' })
      await adapter.deleteTab('m', null)
      expect(await adapter.getButtons()).toEqual([])
      void general
    })

    it('refuses to delete the last remaining tab', async () => {
      const general = (await adapter.getTabs())[0]
      await expect(adapter.deleteTab(general.id, null)).rejects.toThrow('Cannot delete the last tab.')
    })

    it('rejects reassigning to an unknown tab', async () => {
      await adapter.saveTab({ id: 'm', name: 'Marketing', order: 1, emoji: null })
      await expect(adapter.deleteTab('m', 'does-not-exist')).rejects.toThrow(/unknown tab/)
    })

    it('reorders tabs and rewrites their order field', async () => {
      const general = (await adapter.getTabs())[0]
      await adapter.saveTab({ id: 'm', name: 'Marketing', order: 1, emoji: null })
      await adapter.saveTab({ id: 'w', name: 'Writing', order: 2, emoji: null })
      await adapter.reorderTabs(['w', 'm', general.id])
      expect((await adapter.getTabs()).map((t) => [t.id, t.order])).toEqual([
        ['w', 0],
        ['m', 1],
        [general.id, 2],
      ])
    })
  })
})
