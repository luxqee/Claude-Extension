import { beforeEach, describe, expect, it } from 'vitest'
import { ToolService } from '../../src/shared/tool-service'
import { FakeStorageAdapter } from '../support/fake-storage-adapter'

describe('ToolService', () => {
  let storage: FakeStorageAdapter
  let service: ToolService

  beforeEach(() => {
    storage = new FakeStorageAdapter()
    service = new ToolService(storage)
  })

  it('creates a button with an incrementing order and a generated id', async () => {
    const first = await service.createButton('Summarize', 'Summarize this.')
    const second = await service.createButton('Translate', 'Translate this.')
    expect(first.order).toBe(0)
    expect(second.order).toBe(1)
    expect(first.id).not.toBe(second.id)
    expect(first.name).toBe('Summarize')
    expect(first.prompt).toBe('Summarize this.')
  })

  it('continues past the highest existing order after delete-then-create, instead of reusing a count-based order', async () => {
    const a = await service.createButton('A', 'a')
    const b = await service.createButton('B', 'b')
    const c = await service.createButton('C', 'c')
    const d = await service.createButton('D', 'd')
    expect([a.order, b.order, c.order, d.order]).toEqual([0, 1, 2, 3])

    await service.deleteButton(b.id)
    await service.deleteButton(c.id)

    const e = await service.createButton('E', 'e')
    expect(e.order).toBe(4)
  })

  it('lists buttons sorted by order', async () => {
    await storage.saveButton({ id: 'b', tabId: 'tab-general', name: 'B', order: 1, prompt: 'b', type: 'prompt' })
    await storage.saveButton({ id: 'a', tabId: 'tab-general', name: 'A', order: 0, prompt: 'a', type: 'prompt' })
    const buttons = await service.listButtons()
    expect(buttons.map((b) => b.id)).toEqual(['a', 'b'])
  })

  it('updates an existing button, preserving fields not passed', async () => {
    const created = await service.createButton('Name', 'Prompt')
    await service.updateButton(created.id, { name: 'New Name' })
    const [button] = await service.listButtons()
    expect(button.name).toBe('New Name')
    expect(button.prompt).toBe('Prompt')
  })

  it('throws when updating a button that does not exist', async () => {
    await expect(service.updateButton('missing-id', { name: 'X' })).rejects.toThrow(
      'Button not found: missing-id',
    )
  })

  it('deletes a button', async () => {
    const created = await service.createButton('Name', 'Prompt')
    await service.deleteButton(created.id)
    expect(await service.listButtons()).toEqual([])
  })

  it('reorders buttons', async () => {
    const a = await service.createButton('A', 'a')
    const b = await service.createButton('B', 'b')
    await service.reorderButtons([b.id, a.id])
    const buttons = await service.listButtons()
    expect(buttons.map((btn) => btn.id)).toEqual([b.id, a.id])
  })

  it('creates a button with type "prompt" by default', async () => {
    const button = await service.createButton('Summarize', 'Summarize this.')
    expect(button.type).toBe('prompt')
  })

  it('creates a button with an explicit type', async () => {
    const button = await service.createButton('Doc Summary', '/doc-summary', 'skill')
    expect(button.type).toBe('skill')
  })

  it('updates a button\'s type', async () => {
    const created = await service.createButton('Name', '/something', 'prompt')
    await service.updateButton(created.id, { type: 'skill' })
    const [button] = await service.listButtons()
    expect(button.type).toBe('skill')
  })

  it('preserves an existing button\'s type when updating unrelated fields', async () => {
    const created = await service.createButton('Name', '/something', 'skill')
    await service.updateButton(created.id, { name: 'Renamed' })
    const [button] = await service.listButtons()
    expect(button.type).toBe('skill')
    expect(button.name).toBe('Renamed')
  })

  it('puts a new button in the default (first) tab when no tab is given', async () => {
    const button = await service.createButton('X', 'x')
    expect(button.tabId).toBe('tab-general')
  })

  it('numbers button order per tab, not globally', async () => {
    const marketing = await service.createTab('Marketing')
    const a = await service.createButton('A', 'a')
    const b = await service.createButton('B', 'b', 'prompt', marketing.id)
    const c = await service.createButton('C', 'c', 'prompt', marketing.id)
    expect(a.order).toBe(0)
    expect(b.order).toBe(0)
    expect(c.order).toBe(1)
  })

  it('lists all buttons grouped by tab order, then button order', async () => {
    const marketing = await service.createTab('Marketing')
    await service.createButton('general-1', 'g1')
    await service.createButton('mkt-1', 'm1', 'prompt', marketing.id)
    await service.createButton('general-2', 'g2')
    const names = (await service.listButtons()).map((b) => b.name)
    expect(names).toEqual(['general-1', 'general-2', 'mkt-1'])
  })

  it('lists just one tab\'s buttons when given a tabId', async () => {
    const marketing = await service.createTab('Marketing')
    await service.createButton('g1', 'g1')
    await service.createButton('m1', 'm1', 'prompt', marketing.id)
    const names = (await service.listButtons(marketing.id)).map((b) => b.name)
    expect(names).toEqual(['m1'])
  })

  it('moves a button to the end of another tab', async () => {
    const marketing = await service.createTab('Marketing')
    await service.createButton('m1', 'm1', 'prompt', marketing.id)
    const moved = await service.createButton('mover', 'x')
    await service.moveButtonToTab(moved.id, marketing.id)
    const inMarketing = await service.listButtons(marketing.id)
    expect(inMarketing.map((b) => b.name)).toEqual(['m1', 'mover'])
    expect(inMarketing[1].order).toBe(1)
    expect(await service.listButtons('tab-general')).toEqual([])
  })

  it('reorders buttons only within their own tab', async () => {
    const marketing = await service.createTab('Marketing')
    const g1 = await service.createButton('g1', 'g1')
    const g2 = await service.createButton('g2', 'g2')
    const m1 = await service.createButton('m1', 'm1', 'prompt', marketing.id)
    await service.reorderButtons([g2.id, m1.id, g1.id])
    expect((await service.listButtons('tab-general')).map((b) => b.name)).toEqual(['g2', 'g1'])
    expect((await service.listButtons(marketing.id)).map((b) => b.name)).toEqual(['m1'])
  })

  describe('tabs', () => {
    it('creates tabs with incrementing order', async () => {
      const a = await service.createTab('A')
      const b = await service.createTab('B', '🚀')
      expect(a.order).toBe(1) // tab-general seeded at 0
      expect(b.order).toBe(2)
      expect(b.emoji).toBe('🚀')
    })

    it('renames a tab and can change its emoji', async () => {
      const tab = await service.createTab('Old')
      await service.updateTab(tab.id, { name: 'New', emoji: '📁' })
      const [, renamed] = await service.listTabs()
      expect(renamed.name).toBe('New')
      expect(renamed.emoji).toBe('📁')
    })

    it('throws when renaming a tab that does not exist', async () => {
      await expect(service.updateTab('nope', { name: 'X' })).rejects.toThrow('Tab not found: nope')
    })

    it('deletes a tab and moves its buttons to another tab', async () => {
      const marketing = await service.createTab('Marketing')
      await service.createButton('keep-me', 'x', 'prompt', marketing.id)
      await service.deleteTab(marketing.id, 'tab-general')
      expect((await service.listTabs()).map((t) => t.name)).toEqual(['General'])
      expect((await service.listButtons('tab-general')).map((b) => b.name)).toEqual(['keep-me'])
    })

    it('deletes a tab and its buttons when reassignment target is null', async () => {
      const marketing = await service.createTab('Marketing')
      await service.createButton('goner', 'x', 'prompt', marketing.id)
      await service.deleteTab(marketing.id, null)
      expect(await service.listButtons()).toEqual([])
    })

    it('refuses to delete the last remaining tab', async () => {
      await expect(service.deleteTab('tab-general', null)).rejects.toThrow('Cannot delete the last tab.')
    })

    it('reorders tabs', async () => {
      const a = await service.createTab('A')
      const b = await service.createTab('B')
      await service.reorderTabs([b.id, a.id, 'tab-general'])
      expect((await service.listTabs()).map((t) => t.name)).toEqual(['B', 'A', 'General'])
    })

    it('ensureTabByName is case-insensitive and does not duplicate', async () => {
      const first = await service.ensureTabByName('Writing')
      const again = await service.ensureTabByName('writing')
      expect(again.id).toBe(first.id)
      expect((await service.listTabs()).filter((t) => t.name.toLowerCase() === 'writing')).toHaveLength(1)
    })
  })
})
