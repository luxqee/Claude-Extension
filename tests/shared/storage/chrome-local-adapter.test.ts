import { beforeEach, describe, expect, it } from 'vitest'
import { ChromeLocalStorageAdapter } from '../../../src/shared/storage/chrome-local-adapter'
import type { Button } from '../../../src/shared/types'

function installChromeStorageMock() {
  const store = new Map<string, unknown>()
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store.get(key) }),
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) {
            store.set(key, value)
          }
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

  it('returns an empty array when nothing is stored', async () => {
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([])
  })

  it('saves a new button and returns it from getButtons', async () => {
    const button: Button = { id: '1', name: 'Summarize', order: 0, prompt: 'Summarize this.' }
    await adapter.saveButton(button)
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([button])
  })

  it('overwrites an existing button with the same id', async () => {
    await adapter.saveButton({ id: '1', name: 'Old', order: 0, prompt: 'Old prompt' })
    await adapter.saveButton({ id: '1', name: 'New', order: 0, prompt: 'New prompt' })
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([{ id: '1', name: 'New', order: 0, prompt: 'New prompt' }])
  })

  it('deletes a button by id', async () => {
    await adapter.saveButton({ id: '1', name: 'A', order: 0, prompt: 'A' })
    await adapter.saveButton({ id: '2', name: 'B', order: 1, prompt: 'B' })
    await adapter.deleteButton('1')
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([{ id: '2', name: 'B', order: 1, prompt: 'B' }])
  })

  it('reorders buttons and rewrites their order field', async () => {
    await adapter.saveButton({ id: '1', name: 'A', order: 0, prompt: 'A' })
    await adapter.saveButton({ id: '2', name: 'B', order: 1, prompt: 'B' })
    await adapter.reorderButtons(['2', '1'])
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([
      { id: '2', name: 'B', order: 0, prompt: 'B' },
      { id: '1', name: 'A', order: 1, prompt: 'A' },
    ])
  })

  it('returns an empty array when stored data is corrupt (not an array)', async () => {
    store.set('buttons', 'not-an-array')
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([])
  })

  it('drops malformed entries from a corrupt array instead of crashing', async () => {
    store.set('buttons', [
      { id: '1', name: 'Valid', order: 0, prompt: 'ok' },
      { id: '2' },
      null,
      'garbage',
    ])
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([{ id: '1', name: 'Valid', order: 0, prompt: 'ok' }])
  })
})
