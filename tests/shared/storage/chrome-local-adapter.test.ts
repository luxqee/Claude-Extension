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
    const button: Button = { id: '1', name: 'Summarize', order: 0, prompt: 'Summarize this.', type: 'prompt' }
    await adapter.saveButton(button)
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([button])
  })

  it('overwrites an existing button with the same id', async () => {
    await adapter.saveButton({ id: '1', name: 'Old', order: 0, prompt: 'Old prompt', type: 'prompt' })
    await adapter.saveButton({ id: '1', name: 'New', order: 0, prompt: 'New prompt', type: 'prompt' })
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([{ id: '1', name: 'New', order: 0, prompt: 'New prompt', type: 'prompt' }])
  })

  it('deletes a button by id', async () => {
    await adapter.saveButton({ id: '1', name: 'A', order: 0, prompt: 'A', type: 'prompt' })
    await adapter.saveButton({ id: '2', name: 'B', order: 1, prompt: 'B', type: 'prompt' })
    await adapter.deleteButton('1')
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([{ id: '2', name: 'B', order: 1, prompt: 'B', type: 'prompt' }])
  })

  it('reorders buttons and rewrites their order field', async () => {
    await adapter.saveButton({ id: '1', name: 'A', order: 0, prompt: 'A', type: 'prompt' })
    await adapter.saveButton({ id: '2', name: 'B', order: 1, prompt: 'B', type: 'prompt' })
    await adapter.reorderButtons(['2', '1'])
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([
      { id: '2', name: 'B', order: 0, prompt: 'B', type: 'prompt' },
      { id: '1', name: 'A', order: 1, prompt: 'A', type: 'prompt' },
    ])
  })

  it('preserves a stored button omitted from reorderButtons instead of dropping it', async () => {
    await adapter.saveButton({ id: '1', name: 'A', order: 0, prompt: 'A', type: 'prompt' })
    await adapter.saveButton({ id: '2', name: 'B', order: 1, prompt: 'B', type: 'prompt' })
    await adapter.saveButton({ id: '3', name: 'C', order: 2, prompt: 'C', type: 'prompt' })
    // Simulate a stale panel that doesn't know about button '3'.
    await adapter.reorderButtons(['2', '1'])
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([
      { id: '2', name: 'B', order: 0, prompt: 'B', type: 'prompt' },
      { id: '1', name: 'A', order: 1, prompt: 'A', type: 'prompt' },
      { id: '3', name: 'C', order: 2, prompt: 'C', type: 'prompt' },
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
    expect(buttons).toEqual([{ id: '1', name: 'Valid', order: 0, prompt: 'ok', type: 'prompt' }])
  })

  it('defaults a missing type field to "prompt" when reading legacy stored data', async () => {
    store.set('buttons', [{ id: '1', name: 'Legacy', order: 0, prompt: 'hi' }])
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([{ id: '1', name: 'Legacy', order: 0, prompt: 'hi', type: 'prompt' }])
  })

  it('preserves type: "skill" when reading stored data', async () => {
    store.set('buttons', [{ id: '1', name: 'Doc Summary', order: 0, prompt: '/doc-summary', type: 'skill' }])
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([
      { id: '1', name: 'Doc Summary', order: 0, prompt: '/doc-summary', type: 'skill' },
    ])
  })

  it('defaults an unrecognized type value to "prompt" instead of rejecting the button', async () => {
    store.set('buttons', [{ id: '1', name: 'Weird', order: 0, prompt: 'hi', type: 'not-a-real-type' }])
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([{ id: '1', name: 'Weird', order: 0, prompt: 'hi', type: 'prompt' }])
  })
})
